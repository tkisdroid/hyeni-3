/** Node Worker 단위 테스트가 entrypoint 모듈을 평가할 때만 쓰는 최소 런타임 대역이다. */
export class WorkerEntrypoint {
  constructor(ctx, env) {
    this.ctx = ctx;
    this.env = env;
  }
}
