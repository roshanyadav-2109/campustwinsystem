// Shared by server and browser.
// Gateways an institution can choose. Those without a connector yet are
// connected by CampusTwin when the institution's merchant account is ready.
export const GATEWAY_CHOICES: { id: string; label: string }[] = [
  { id: "test", label: "Test gateway (no real money)" },
  { id: "billdesk", label: "BillDesk" },
  { id: "paytm", label: "Paytm" },
  { id: "razorpay", label: "Razorpay" },
  { id: "payu", label: "PayU" },
  { id: "cashfree", label: "Cashfree" },
  { id: "ccavenue", label: "CCAvenue" },
  { id: "easebuzz", label: "Easebuzz" },
  { id: "phonepe", label: "PhonePe" },
  { id: "hdfc", label: "HDFC SmartGateway" },
  { id: "icici", label: "ICICI Eazypay" },
  { id: "sbi", label: "SBI ePay" },
];
export const CONNECTED = new Set(["test"]);   // gateways with a connector built
