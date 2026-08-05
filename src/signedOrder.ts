import { getChain } from "./chains.js";
import type { OrderTradeFields, SubmitOrderRequest } from "./types.js";

export interface SignedOrderFields {
  funderAddress: string;
  quoteId: string;
  bridgeQuoteId?: string;
  erc8021AttributionCode?: string;
  userSignature: string;
  evmOrderTypedData?: string;
  evmPermitTypedData?: string;
  evmPermitSignature?: string;
  svmNonce?: string;
  svmDeadline?: string;
  svmSponsoredDelegateTx?: string;
}

function requireNonEmpty(name: string, value: string): void {
  if (!value.trim()) throw new Error(`${name} must be a non-empty string.`);
}

function rejectPresent(fields: SignedOrderFields, names: (keyof SignedOrderFields)[], family: string): void {
  const present = names.filter((name) => fields[name] !== undefined);
  if (present.length) throw new Error(`${present.join(", ")} cannot be used for a ${family} order.`);
}

export function buildSignedOrderRequest(
  tradeFields: OrderTradeFields,
  fields: SignedOrderFields,
): SubmitOrderRequest {
  requireNonEmpty("quoteId", fields.quoteId);
  requireNonEmpty("funderAddress", fields.funderAddress);
  requireNonEmpty("userSignature", fields.userSignature);
  if (fields.bridgeQuoteId !== undefined) requireNonEmpty("bridgeQuoteId", fields.bridgeQuoteId);
  if (
    fields.erc8021AttributionCode !== undefined &&
    !/^[a-zA-Z0-9_.-]{1,32}$/.test(fields.erc8021AttributionCode)
  ) {
    throw new Error(
      "erc8021AttributionCode must be 1-32 letters, numbers, underscores, periods, or hyphens.",
    );
  }
  if (tradeFields.targetChain !== tradeFields.contraChain) {
    if (!tradeFields.recipientAddress?.trim()) {
      throw new Error("recipientAddress is required for a cross-chain order.");
    }
    if (!fields.bridgeQuoteId?.trim()) {
      throw new Error("bridgeQuoteId is required for a cross-chain order.");
    }
  }

  const common: SubmitOrderRequest = {
    ...tradeFields,
    funderAddress: fields.funderAddress,
    quoteId: fields.quoteId,
    ...(fields.bridgeQuoteId !== undefined ? { bridgeQuoteId: fields.bridgeQuoteId } : {}),
    ...(fields.erc8021AttributionCode !== undefined
      ? { erc8021AttributionCode: fields.erc8021AttributionCode }
      : {}),
    userSignature: fields.userSignature,
  };

  if (getChain(tradeFields.targetChain).kind === "evm") {
    rejectPresent(fields, ["svmNonce", "svmDeadline", "svmSponsoredDelegateTx"], "EVM");
    if (fields.evmOrderTypedData === undefined) {
      throw new Error("evmOrderTypedData is required for an EVM order.");
    }
    requireNonEmpty("evmOrderTypedData", fields.evmOrderTypedData);

    const hasPermitData = fields.evmPermitTypedData !== undefined;
    const hasPermitSignature = fields.evmPermitSignature !== undefined;
    if (hasPermitData !== hasPermitSignature) {
      throw new Error("evmPermitTypedData and evmPermitSignature must be provided together.");
    }

    return {
      ...common,
      evmOrderTypedData: fields.evmOrderTypedData,
      ...(hasPermitData
        ? {
            evmPermitTypedData: fields.evmPermitTypedData,
            evmPermitSignature: fields.evmPermitSignature,
          }
        : {}),
    };
  }

  rejectPresent(
    fields,
    ["evmOrderTypedData", "evmPermitTypedData", "evmPermitSignature"],
    "SVM",
  );
  return {
    ...common,
    ...(fields.svmNonce !== undefined ? { svmNonce: fields.svmNonce } : {}),
    ...(fields.svmDeadline !== undefined ? { svmDeadline: fields.svmDeadline } : {}),
    ...(fields.svmSponsoredDelegateTx !== undefined
      ? { svmSponsoredDelegateTx: fields.svmSponsoredDelegateTx }
      : {}),
  };
}
