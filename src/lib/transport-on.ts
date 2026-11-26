import { getSession } from "@/lib/session";

// Transport shows for a school only when its "transport" module is switched on
// (console, Settings, Modules).
export async function transportOn(): Promise<boolean> {
  const session = await getSession();
  return !!session?.school.modules?.transport;
}
