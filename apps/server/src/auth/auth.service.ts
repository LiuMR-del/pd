import { Inject, Injectable } from '@nestjs/common';
import { CONFIG, type AppConfig } from '../config';
import { conflict, unauthorized } from '../common/http';
import { PrismaService } from '../prisma.service';
import { DUMMY_HASH, hashPassword, newRefreshToken, sha256, signAccess, verifyPassword } from './crypto';
import { WechatClient } from './wechat';

export const ACCESS_TTL_SEC = 2 * 60 * 60;
export const REFRESH_TTL_MS = 30 * 24 * 60 * 60 * 1000;
export const REFRESH_GRACE_MS = 30 * 1000;

export interface TokenPair {
  accessToken: string;
  /** Seconds until the access token expires. */
  expiresIn: number;
  refreshToken: string;
}

export interface PublicUser {
  id: string;
  username: string | null;
  nickname: string;
  hasPassword: boolean;
  hasWechat: boolean;
  createdAt: string;
}

type UserRow = { id: string; username: string | null; nickname: string; passwordHash: string | null; wxOpenId: string | null; createdAt: Date };

export function publicUser(u: UserRow): PublicUser {
  return {
    id: u.id,
    username: u.username,
    nickname: u.nickname,
    hasPassword: !!u.passwordHash,
    hasWechat: !!u.wxOpenId,
    createdAt: u.createdAt.toISOString(),
  };
}

@Injectable()
export class AuthService {
  /** Window in which replaying a just-rotated refresh token is treated as a race, not theft. */
  graceMs = REFRESH_GRACE_MS;

  constructor(
    @Inject(CONFIG) private readonly config: AppConfig,
    @Inject(PrismaService) private readonly db: PrismaService,
    @Inject(WechatClient) private readonly wechat: WechatClient,
  ) {}

  async register(username: string, password: string, userAgent: string): Promise<{ user: PublicUser; tokens: TokenPair }> {
    const name = username.toLowerCase();
    if (await this.db.user.findUnique({ where: { username: name } })) throw conflict('这个用户名已被使用', 'username_taken');
    const user = await this.db.user
      .create({ data: { username: name, passwordHash: await hashPassword(password), nickname: username } })
      .catch((e: unknown) => {
        // two registrations racing for the same name
        if ((e as { code?: string }).code === 'P2002') throw conflict('这个用户名已被使用', 'username_taken');
        throw e;
      });
    return { user: publicUser(user), tokens: await this.issue(user.id, userAgent) };
  }

  async login(username: string, password: string, userAgent: string): Promise<{ user: PublicUser; tokens: TokenPair }> {
    const user = await this.db.user.findUnique({ where: { username: username.toLowerCase() } });
    const ok = await verifyPassword(password, user?.passwordHash ?? DUMMY_HASH);
    if (!user || !user.passwordHash || !ok) throw unauthorized('用户名或密码不对', 'bad_credentials');
    return { user: publicUser(user), tokens: await this.issue(user.id, userAgent) };
  }

  /** Mini-program login: creates the account on first use. */
  async wxLogin(code: string, userAgent: string): Promise<{ user: PublicUser; tokens: TokenPair; created: boolean }> {
    const s = await this.wechat.code2Session(code);
    let created = false;
    let user = await this.db.user.findUnique({ where: { wxOpenId: s.openid } });
    if (!user) {
      user = await this.db.user.create({ data: { wxOpenId: s.openid, wxUnionId: s.unionid ?? null, nickname: '拼豆用户' } });
      created = true;
    }
    return { user: publicUser(user), tokens: await this.issue(user.id, userAgent), created };
  }

  /**
   * Rotates a refresh token. Presenting an already-rotated (revoked) token means it leaked or was
   * replayed: every session of that user is revoked.
   */
  async refresh(refreshToken: string, userAgent: string): Promise<TokenPair> {
    const s = await this.db.session.findUnique({ where: { tokenHash: sha256(refreshToken) } });
    if (!s) throw unauthorized('登录已过期，请重新登录', 'refresh_invalid');
    if (s.revokedAt) {
      // two tabs refreshing at the same moment: the loser only gets a 401, nobody is signed out
      if (Date.now() - s.revokedAt.getTime() < this.graceMs) throw unauthorized('登录已更新，请重试', 'refresh_raced');
      await this.revokeAll(s.userId);
      throw unauthorized('登录已失效，请重新登录', 'refresh_reused');
    }
    if (s.expiresAt.getTime() <= Date.now()) throw unauthorized('登录已过期，请重新登录', 'refresh_expired');
    const r = await this.db.session.updateMany({ where: { id: s.id, revokedAt: null }, data: { revokedAt: new Date() } });
    if (r.count !== 1) throw unauthorized('登录已失效，请重新登录', 'refresh_reused');
    return this.issue(s.userId, userAgent);
  }

  async logout(refreshToken: string): Promise<void> {
    await this.db.session.updateMany({ where: { tokenHash: sha256(refreshToken), revokedAt: null }, data: { revokedAt: new Date() } });
  }

  async revokeAll(userId: string): Promise<void> {
    await this.db.session.updateMany({ where: { userId, revokedAt: null }, data: { revokedAt: new Date() } });
  }

  /** Changes (or sets, for WeChat-only accounts) the password and signs out every other session. */
  async changePassword(userId: string, oldPassword: string | undefined, newPassword: string, userAgent: string): Promise<TokenPair> {
    const user = await this.db.user.findUnique({ where: { id: userId } });
    if (!user) throw unauthorized();
    if (user.passwordHash && !(await verifyPassword(oldPassword ?? '', user.passwordHash))) throw unauthorized('原密码不对', 'bad_credentials');
    await this.db.user.update({ where: { id: userId }, data: { passwordHash: await hashPassword(newPassword) } });
    await this.revokeAll(userId);
    return this.issue(userId, userAgent);
  }

  /**
   * Binds the WeChat of a `wx.login()` code to the signed-in account, so the mini-program's one-tap
   * login opens this account from now on. An empty WeChat-only account already holding that WeChat
   * (made by an earlier one-tap login, no works, no password) is deleted; any other holder is refused
   * rather than merged. Returns the updated user and the id of a deleted account (its files go too).
   */
  async wxBind(userId: string, code: string): Promise<{ user: PublicUser; removedUserId: string | null }> {
    const me = await this.db.user.findUnique({ where: { id: userId } });
    if (!me) throw unauthorized('账号不存在', 'user_not_found');
    const s = await this.wechat.code2Session(code);
    if (me.wxOpenId === s.openid) return { user: publicUser(me), removedUserId: null };
    if (me.wxOpenId) throw conflict('这个账号已经绑定了另一个微信', 'wx_already_bound');
    const holder = await this.db.user.findUnique({ where: { wxOpenId: s.openid }, include: { _count: { select: { works: true } } } });
    if (holder && (holder.passwordHash || holder._count.works > 0))
      throw conflict('这个微信已经在用另一个账号（里面有作品或设置了密码），不能再绑定。可以先用微信登录那个账号处理', 'wx_in_use');
    const user = await this.db
      .$transaction(async (tx) => {
        if (holder) await tx.user.delete({ where: { id: holder.id } });
        return tx.user.update({ where: { id: userId }, data: { wxOpenId: s.openid, wxUnionId: s.unionid ?? null } });
      })
      .catch((e: unknown) => {
        // the same WeChat bound to another account at the same moment
        if ((e as { code?: string }).code === 'P2002') throw conflict('这个微信已经绑定了别的账号', 'wx_in_use');
        throw e;
      });
    return { user: publicUser(user), removedUserId: holder?.id ?? null };
  }

  /** Gives an account without a password (WeChat-only) a username and password for the web app. */
  async setCredentials(userId: string, username: string, password: string): Promise<PublicUser> {
    const me = await this.db.user.findUnique({ where: { id: userId } });
    if (!me) throw unauthorized('账号不存在', 'user_not_found');
    if (me.passwordHash || me.username) throw conflict('这个账号已经有用户名和密码了，可以用「修改密码」', 'credentials_exist');
    const name = username.toLowerCase();
    if (await this.db.user.findUnique({ where: { username: name } })) throw conflict('这个用户名已被使用', 'username_taken');
    const user = await this.db.user
      .update({ where: { id: userId }, data: { username: name, passwordHash: await hashPassword(password) } })
      .catch((e: unknown) => {
        if ((e as { code?: string }).code === 'P2002') throw conflict('这个用户名已被使用', 'username_taken');
        throw e;
      });
    return publicUser(user);
  }

  async checkPassword(userId: string, password: string): Promise<void> {
    const user = await this.db.user.findUnique({ where: { id: userId } });
    if (!user) throw unauthorized();
    if (user.passwordHash && !(await verifyPassword(password, user.passwordHash))) throw unauthorized('密码不对', 'bad_credentials');
  }

  private async issue(userId: string, userAgent: string): Promise<TokenPair> {
    const refreshToken = newRefreshToken();
    await this.db.session.create({
      data: { userId, tokenHash: sha256(refreshToken), expiresAt: new Date(Date.now() + REFRESH_TTL_MS), userAgent: userAgent.slice(0, 255) },
    });
    return { accessToken: signAccess({ sub: userId }, this.config.jwtSecret, ACCESS_TTL_SEC), expiresIn: ACCESS_TTL_SEC, refreshToken };
  }
}
