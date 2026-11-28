import "server-only";
import type { HostedGateway } from "@/core/payments/hosted";
import { payu } from "@/core/payments/payu";
import { cashfree } from "@/core/payments/cashfree";
import { easebuzz } from "@/core/payments/easebuzz";

// The hosted gateways, each in its own file.
export const HOSTED: Record<string, HostedGateway> = { payu, cashfree, easebuzz };
