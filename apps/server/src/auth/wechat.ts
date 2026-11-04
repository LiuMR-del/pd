import { Inject, Injectable } from '@nestjs/common';
import { CONFIG, type AppConfig } from '../config';
import { ApiError } from '../common/http';

export interface WxSession {
  openid: string;
  unionid?: string;
}

/** Fetch is injectable so tests can fake WeChat's code2Session endpoint. */
export const WX_FETCH = Symbol('WX_FETCH');
export type WxFetch = (url: string) => Promise<{ json(): Promise<unknown> }>;

@Injectable()
export class WechatClient {
  constructor(
    @Inject(CONFIG) private readonly config: AppConfig,
    @Inject(WX_FETCH) private readonly fetchFn: WxFetch,
  ) {}

  /** Exchanges a `wx.login()` code for the user's openid (auth.code2Session). */
  async code2Session(code: string): Promise<WxSession> {
    const wx = this.config.wx;
    if (!wx) throw new ApiError(503, 'wx_not_configured', '服务器未配置小程序登录');
    const q = new URLSearchParams({ appid: wx.appId, secret: wx.secret, js_code: code, grant_type: 'authorization_code' });
    let data: { openid?: string; unionid?: string; errcode?: number; errmsg?: string };
    try {
      const res = await this.fetchFn(`https://api.weixin.qq.com/sns/jscode2session?${q}`);
      data = (await res.json()) as typeof data;
    } catch {
      throw new ApiError(502, 'wx_unreachable', '连接微信服务器失败，请稍后再试');
    }
    if (!data.openid) throw new ApiError(401, 'wx_code_invalid', `微信登录失败（${data.errcode ?? '?'}）`);
    return { openid: data.openid, unionid: data.unionid };
  }
}
