export interface UserApi { getUser(id: string): Promise<{ id: string }>; }
export class UserController implements UserApi { async getUser(id: string) { return { id }; } }
