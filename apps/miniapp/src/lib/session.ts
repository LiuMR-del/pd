/** Id of the signed-in account (null: signed out). Kept apart so storage code can read it without importing the cloud module. */
export const session = { uid: null as string | null };
