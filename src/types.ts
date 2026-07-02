// Types mirroring the Definitive Flash API (https://flash.definitive.fi/v1/openapi.json).
// Only the fields this server reads or writes are typed; unknown extras pass through.

export type OrderType = "market" | "limit" | "twap" | "stop" | "stop-loss" | "take-profit" | "bracket";
export type OrderSide = "buy" | "sell";
export type TriggerType = "upper" | "lower";

export interface PriceTrigger {
  notionalPrice: string;
  triggerType: TriggerType;
}

export interface QuoteRequest {
  targetChain: string;
  contraChain: string;
  targetAsset: string;
  contraAsset: string;
  side: OrderSide;
  qty: string;
  orderType: OrderType;
  quickTrade?: boolean;
  maxSlippage?: string;
  maxPriceImpact?: string;
  limitNotionalPrice?: string;
  funderAddress?: string;
  svmUseNativeSOL?: boolean;
  flashIntegratorFeeBps?: string;
  expireTime?: string;
  durationSeconds?: number;
  twapBucketCount?: number;
  triggers?: PriceTrigger[];
}

export interface QuoteLeg {
  asset: "target" | "contra";
  amount: string;
  notional: string;
}

export interface QuoteFees {
  estimatedFeeNotional: string;
}

export interface EvmTx {
  to: string;
  data: string;
  value?: string;
}

export interface QuoteEvmActions {
  approveTx: EvmTx | null;
  permitTypedData: string | null;
  orderTypedData: string | null;
}

export interface SvmAccountMeta {
  pubkey: string;
  isSigner: boolean;
  isWritable: boolean;
}

export interface SvmInstruction {
  programId: string;
  accounts: SvmAccountMeta[];
  data: string; // base58
}

export interface QuoteSvmActions {
  delegateIx: SvmInstruction | null;
  sponsoredDelegateTx: string | null; // base64 VersionedTransaction
  orderMessage: string | null;
  nonce: string | null;
  deadline: string | null;
}

export interface QuoteWrapAction {
  nativeAsset: string;
  wrappedAsset: string;
  evmTx: EvmTx | null;
  svmInstructions: SvmInstruction[] | null;
}

export interface QuoteResponse {
  quoteId: string;
  orderType: OrderType;
  side: OrderSide;
  targetAsset: string;
  contraAsset: string;
  from: QuoteLeg;
  to: QuoteLeg;
  fees: QuoteFees;
  wrap: QuoteWrapAction | null;
  evm: QuoteEvmActions | null;
  svm: QuoteSvmActions | null;
}

export interface SubmitOrderRequest extends QuoteRequest {
  funderAddress: string;
  quoteId?: string;
  userSignature: string;
  evmOrderTypedData?: string;
  evmPermitTypedData?: string;
  evmPermitSignature?: string;
  svmNonce?: string;
  svmDeadline?: string;
  svmSponsoredDelegateTx?: string;
}

export interface SubmitOrderResponse {
  orderId: string;
}

export type FlashOrderStatus =
  | "ORDER_STATUS_UNSPECIFIED"
  | "ORDER_STATUS_PENDING"
  | "ORDER_STATUS_ACCEPTED"
  | "ORDER_STATUS_PARTIALLY_FILLED"
  | "ORDER_STATUS_FILLED"
  | "ORDER_STATUS_CANCELLED"
  | "ORDER_STATUS_REJECTED"
  | "ORDER_STATUS_TERMINATED";

export const TERMINAL_STATUSES: ReadonlySet<FlashOrderStatus> = new Set([
  "ORDER_STATUS_FILLED",
  "ORDER_STATUS_CANCELLED",
  "ORDER_STATUS_REJECTED",
  "ORDER_STATUS_TERMINATED",
]);

export interface FlashAssetChainRef {
  id: string;
  name: string;
  namespace: string;
}

export interface FlashAssetRef {
  id: string;
  name: string;
  address: string;
  ticker: string;
  chain: FlashAssetChainRef;
}

export interface FlashOrderFilled {
  targetAmount: string | null;
  contraAmount: string | null;
  averagePrice: string | null;
  averageNotionalPrice: string | null;
}

export interface FlashOrder {
  orderId: string;
  orderType: OrderType;
  side: OrderSide;
  status: FlashOrderStatus;
  closeReason: string | null;
  funderAddress: string;
  targetAsset: FlashAssetRef;
  contraAsset: FlashAssetRef;
  qty: string;
  filled: FlashOrderFilled;
  limitNotionalPrice: string | null;
  trigger: PriceTrigger | null;
  brackets: PriceTrigger[] | null;
  maxPriceImpact: string | null;
  twapBucketCount: number | null;
  placedAt: string;
  acceptedAt: string | null;
  closedAt: string | null;
}

export interface FlashFill {
  status: string;
  notional: string;
  venues: string[];
  filledAt: string;
  orderId: string;
  rootOrderId: string;
  transactionId: string;
  fillPrice: string;
  feeNotional: string;
  contraAmount: string;
  targetAmount: string;
  [k: string]: unknown;
}

export interface FlashGetOrderResponse {
  order: FlashOrder;
  fills: FlashFill[];
}

export interface FlashListOrdersResponse {
  orders: FlashOrder[];
}

export interface CancelOrderRequest {
  cancelMessage: string;
  userSignature: string;
}
