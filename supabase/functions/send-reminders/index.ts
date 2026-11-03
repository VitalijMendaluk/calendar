import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import webpush from "npm:web-push";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const CRON_SECRET = Deno.env.get("CRON_SECRET")!;
const VAPID_PUBLIC_KEY = Deno.env.get("VAPID_PUBLIC_KEY")!;
const VAPID_PRIVATE_KEY = Deno.env.get("VAPID_PRIVATE_KEY")!;
const VAPID_SUBJECT = Deno.env.get("VAPID_SUBJECT") || "mailto:calendar-owner@example.com";

webpush.setVapidDetails(VAPID_SUBJECT, VAPID_PUBLIC_KEY, VAPID_PRIVATE_KEY);
const db = createClient(SUPABASE_URL, SERVICE_ROLE_KEY);

Deno.serve(async (req) => {
  if (req.headers.get("x-cron-secret") !== CRON_SECRET) {
    return new Response("Unauthorized", { status: 401 });
  }

  const now = new Date().toISOString();
  const { data: due, error } = await db
    .from("consultations")
    .select("id, owner_id, title, starts_at, timezone")
    .is("reminder_sent_at", null)
    .lte("reminder_at", now)
    .gte("reminder_at", new Date(Date.now() - 3 * 60 * 1000).toISOString())
    .limit(100);

  if (error) return Response.json({ error: error.message }, { status: 500 });
  let sent = 0;
  let failed = 0;

  for (const item of due || []) {
    const { data: subscriptions } = await db
      .from("push_subscriptions")
      .select("id, endpoint, subscription")
      .eq("owner_id", item.owner_id);

    if (!subscriptions?.length) continue;

    const localTime = new Intl.DateTimeFormat("uk-UA", {
      timeZone: item.timezone,
      dateStyle: "short",
      timeStyle: "short"
    }).format(new Date(item.starts_at));

    let allSucceeded = true;
    for (const sub of subscriptions) {
      try {
        await webpush.sendNotification(
          sub.subscription,
          JSON.stringify({
            title: "Консультація через 30 хвилин",
            body: `${item.title} · ${localTime}`,
            tag: `consultation-${item.id}`,
            url: "/"
          })
        );
        sent++;
      } catch (err) {
        allSucceeded = false;
        const statusCode = (err as { statusCode?: number })?.statusCode;
        if (statusCode === 404 || statusCode === 410) {
          await db.from("push_subscriptions").delete().eq("id", sub.id);
        }
        console.error("Push failed", item.id, statusCode, err);
      }
    }

    if (allSucceeded) {
      await db.from("consultations").update({ reminder_sent_at: now }).eq("id", item.id);
    } else {
      failed++;
    }
  }

  return Response.json({ checked: due?.length || 0, sent, failed });
});
