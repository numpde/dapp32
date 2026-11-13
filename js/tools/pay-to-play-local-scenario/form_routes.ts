// Form routes used by both Pay-to-Play scenario campaigns. They follow the
// authored CAM; production viewer navigation remains defined in the manifest.
export const formForWrite: Record<string, string> = {
  registerVoucherKey: "voucherPaymentsForm",
  collect: "voucherPaymentsForm",
  fund: "depositForm",
  requestWithdrawal: "withdrawalForm",
  setWithdrawal: "withdrawalForm",
  withdraw: "withdrawalForm",
  move: "withdrawalForm",
  setCollector: "channelSettingsForm",
  setPayee: "channelSettingsForm",
}
