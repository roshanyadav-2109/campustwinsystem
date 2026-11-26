"use client";
import { useTransition } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import { markNotificationsRead } from "@/app/dashboard/notifications/actions";

export function MarkAllRead({ ids }: { ids: number[] }) {
  const [pending, start] = useTransition();
  const router = useRouter();
  return (
    <Button variant="subtle" size="sm" disabled={pending} onClick={() => start(async () => { await markNotificationsRead(ids); router.refresh(); })}>
      {pending ? "Marking…" : `Mark ${ids.length} as read`}
    </Button>
  );
}
