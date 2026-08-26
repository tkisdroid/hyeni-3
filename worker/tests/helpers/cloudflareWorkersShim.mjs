/** Node 단위 테스트에서만 쓰는 Cloudflare named-entrypoint 최소 대역입니다. */
export class WorkerEntrypoint {
  constructor(context = undefined, env = undefined) {
    this.ctx = context;
    this.env = env;
  }
}
