const TOSS_SDK_URL = "https://js.tosspayments.com/v2/standard";

interface TossBillingPayment {
  requestBillingAuth(input: {
    method: "CARD";
    successUrl: string;
    failUrl: string;
    windowTarget: "self";
  }): Promise<void>;
  requestPayment(input: {
    method: "CARD";
    amount: { currency: "KRW"; value: number };
    orderId: string;
    orderName: string;
    successUrl: string;
    failUrl: string;
    windowTarget: "self";
  }): Promise<void>;
}

interface TossPaymentsInstance {
  payment(input: { customerKey: string }): TossBillingPayment;
}

type TossPaymentsFactory = (clientKey: string) => TossPaymentsInstance;

type BillingWindow = Window & { TossPayments?: TossPaymentsFactory };

let sdkPromise: Promise<TossPaymentsFactory> | null = null;

function currentFactory(): TossPaymentsFactory | null {
  if (typeof window === "undefined") return null;
  return (window as BillingWindow).TossPayments ?? null;
}

/** 공식 SDK v2를 한 번만 로드한다. secret/customer/auth key는 script URL이나 로그에 싣지 않는다. */
export function loadTossBillingSdk(): Promise<TossPaymentsFactory> {
  const loaded = currentFactory();
  if (loaded) return Promise.resolve(loaded);
  if (sdkPromise) return sdkPromise;
  if (typeof document === "undefined") return Promise.reject(new Error("web_billing_browser_required"));

  sdkPromise = new Promise<TossPaymentsFactory>((resolve, reject) => {
    const existing = document.querySelector<HTMLScriptElement>(`script[src="${TOSS_SDK_URL}"]`);
    const script = existing ?? document.createElement("script");
    let settled = false;
    const finish = () => {
      if (settled) return;
      const factory = currentFactory();
      if (!factory) {
        settled = true;
        sdkPromise = null;
        reject(new Error("web_billing_sdk_unavailable"));
        return;
      }
      settled = true;
      resolve(factory);
    };
    const fail = () => {
      if (settled) return;
      settled = true;
      sdkPromise = null;
      reject(new Error("web_billing_sdk_unavailable"));
    };
    script.addEventListener("load", finish, { once: true });
    script.addEventListener("error", fail, { once: true });
    if (!existing) {
      script.src = TOSS_SDK_URL;
      script.async = true;
      script.referrerPolicy = "no-referrer";
      document.head.appendChild(script);
    }
    window.setTimeout(() => {
      if (!settled) fail();
    }, 15_000);
    // 기존 태그가 아직 내려받는 중일 수 있으므로 즉시 실패 판정하지 않는다.
    // 이미 로드되어 정상 factory가 있는 경우는 함수 진입부에서 반환했고,
    // 나머지는 load/error 또는 15초 상한으로만 확정한다.
  });
  return sdkPromise;
}

export async function startTossBillingAuthorization(input: {
  clientKey: string;
  customerKey: string;
  successUrl: string;
  failUrl: string;
}): Promise<void> {
  const TossPayments = await loadTossBillingSdk();
  const payment = TossPayments(input.clientKey).payment({ customerKey: input.customerKey });
  await payment.requestBillingAuth({
    method: "CARD",
    successUrl: input.successUrl,
    failUrl: input.failUrl,
    windowTarget: "self",
  });
}

/** 서버가 확정한 KRW 금액과 주문 번호로 Toss 일회성 카드 결제를 연다. */
export async function startTossOneTimePayment(input: {
  clientKey: string;
  customerKey: string;
  orderId: string;
  credits: number;
  amount: number;
  successUrl: string;
  failUrl: string;
}): Promise<void> {
  const TossPayments = await loadTossBillingSdk();
  const payment = TossPayments(input.clientKey).payment({ customerKey: input.customerKey });
  await payment.requestPayment({
    method: "CARD",
    amount: { currency: "KRW", value: input.amount },
    orderId: input.orderId,
    orderName: `AI 크레딧 ${input.credits}회`,
    successUrl: input.successUrl,
    failUrl: input.failUrl,
    windowTarget: "self",
  });
}
