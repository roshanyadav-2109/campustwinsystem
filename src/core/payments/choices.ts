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
export const CONNECTED = new Set(["test", "razorpay", "payu", "cashfree", "easebuzz"]);   // gateways with a connector built

// The keys each hosted gateway needs: public ones are kept in the gateway's settings, secret ones only in the vault.
export type GatewayField = { name: string; label: string; secret: boolean; hint?: string };
export const GATEWAY_FIELDS: Record<string, GatewayField[]> = {
  payu: [
    { name: "key", label: "Merchant key", secret: false, hint: "PayU dashboard, Developers, API keys" },
    { name: "salt", label: "Salt (v1)", secret: true, hint: "The 32-character salt shown with the key" },
  ],
  cashfree: [
    { name: "app_id", label: "App ID (client id)", secret: false, hint: "Cashfree dashboard, Developers, API keys" },
    { name: "secret_key", label: "Secret key (client secret)", secret: true },
  ],
  easebuzz: [
    { name: "key", label: "Merchant key", secret: false, hint: "Easebuzz dashboard, Settings, API keys" },
    { name: "salt", label: "Salt", secret: true },
  ],
};
