"""
Daily check on the family tree's Supabase project; emails the owner when something needs doing.

Run by .github/workflows/family-tree-monitor.yml. Reads dates and counts only, through the
monitor_report() database function and a secret token (see README "Reminders").

Emails:
  - every Monday: a short status (also proves this check is still running)
  - days 4 and 6 without any family activity: the free plan pauses a project after 7 days
  - Mondays while the last backup export is over 30 days old (or never)
  - every day the database doesn't answer: it is probably paused; restore within 90 days
  - TEST=true: always sends the status, for checking the setup

Uses only the Python standard library.
"""
from __future__ import annotations

import json
import os
import smtplib
import sys
import urllib.error
import urllib.request
from datetime import datetime, timedelta, timezone
from email.message import EmailMessage

URL = os.environ.get("SUPABASE_URL", "https://uzpcqcvljkgdwofipuoe.supabase.co")
KEY = os.environ.get("SUPABASE_KEY", "sb_publishable_9o9urMxfX1Y2a-yx61T0Vw_G8k_Kkan")
TOKEN = os.environ.get("MONITOR_TOKEN", "")
GMAIL_USER = os.environ.get("GMAIL_USER", "")
GMAIL_PASSWORD = os.environ.get("GMAIL_APP_PASSWORD", "").replace(" ", "")
TO = os.environ.get("NOTIFY_EMAIL", "") or GMAIL_USER
TEST = os.environ.get("TEST", "").lower() == "true"
APP = "https://mrpai13-web.github.io/herbarium-family-tree/"
DASHBOARD = "https://supabase.com/dashboard/projects"
TZ = timezone(timedelta(hours=-10), "HST")  # Hawaii: no daylight saving

PAUSE_DAYS = 7      # Supabase free plan: paused after 1 week of inactivity
RESTORE_DAYS = 90   # paused free projects can be restored from the dashboard for 90 days
BACKUP_DAYS = 30    # remind to export a backup after this long
WARN_ON = (4, 6)    # days without activity that trigger a "pauses soon" email


def parse(ts: str | None) -> datetime | None:
    return datetime.fromisoformat(ts.replace("Z", "+00:00")) if ts else None


def local(d: datetime | None) -> str:
    return d.astimezone(TZ).strftime("%a %d %b %Y, %I:%M %p").replace(" 0", " ") if d else "never"


def days_since(d: datetime | None, now: datetime) -> int | None:
    return None if d is None else (now - d).days


def fetch_report() -> tuple[dict | None, str | None]:
    """The report, or (None, why) when the database didn't answer properly."""
    req = urllib.request.Request(
        f"{URL}/rest/v1/rpc/monitor_report",
        data=json.dumps({"p_token": TOKEN}).encode(),
        headers={"apikey": KEY, "Content-Type": "application/json"},
        method="POST",
    )
    try:
        with urllib.request.urlopen(req, timeout=60) as r:
            return json.loads(r.read()), None
    except urllib.error.HTTPError as e:
        body = e.read().decode(errors="replace")[:300]
        if "not allowed" in body:
            return None, "token"
        return None, f"HTTP {e.code}: {body}"
    except Exception as e:  # network, DNS (a long-paused project's address can stop resolving)
        return None, str(e)


def send(subject: str, body: str) -> None:
    if not (GMAIL_USER and GMAIL_PASSWORD and TO):
        print("Email not set up (GMAIL_USER / GMAIL_APP_PASSWORD secrets). Would have sent:\n", subject, "\n", body)
        return
    msg = EmailMessage()
    msg["Subject"] = subject
    msg["From"] = f"Family tree reminders <{GMAIL_USER}>"
    msg["To"] = TO
    msg.set_content(body)
    with smtplib.SMTP_SSL("smtp.gmail.com", 465, timeout=60) as s:
        s.login(GMAIL_USER, GMAIL_PASSWORD)
        s.send_message(msg)
    print("Sent:", subject)


def main() -> int:
    now = datetime.now(timezone.utc)
    monday = now.astimezone(TZ).weekday() == 0
    report, problem = fetch_report()

    if report is None and problem == "token":
        send("Family tree reminders: setup problem",
             "The daily check reached the database but its token was refused.\n"
             "Run the token SQL from the README (\"Reminders\") again, or set the MONITOR_TOKEN secret on GitHub.")
        return 1
    if report is None:
        deadline = (now + timedelta(days=RESTORE_DAYS - 1)).astimezone(TZ).strftime("%d %b %Y")
        send("Family tree: the database isn't answering (probably paused)",
             "Today's check couldn't reach the family tree's database. On the free plan this usually means it\n"
             "was paused after a week with no use. Nothing is lost while it's paused.\n\n"
             "To restore it:\n"
             f"  1. Sign in at {DASHBOARD}\n"
             "  2. Open the FamilyBook project and click \"Restore project\" (takes a few minutes).\n\n"
             f"Do it soon: a paused free project can be restored with one click for {RESTORE_DAYS} days after it\n"
             f"paused (at the latest around {deadline}, earlier if it paused before today).\n"
             "Until then relatives see their saved copy; edits they make wait on their device and upload\n"
             "once it's back, as long as they don't sign out.\n\n"
             f"Details: {problem}")
        return 1

    last_edit = parse(report.get("last_edit"))
    last_visit = parse(report.get("last_visit"))
    last_sign_in = parse(report.get("last_sign_in"))
    owner_sign_in = parse(report.get("owner_last_sign_in"))
    owner_visit = parse(report.get("owner_last_visit"))
    last_export = parse(report.get("last_export"))
    activity = max([d for d in (last_edit, last_visit, last_sign_in) if d], default=None)
    idle = days_since(activity, now)
    backup_age = days_since(last_export, now)

    reasons: list[str] = []
    if idle is not None and idle in WARN_ON:
        left = PAUSE_DAYS - idle
        reasons.append(
            f"Nobody has opened or edited the tree for {idle} days. The free plan pauses a project after\n"
            f"{PAUSE_DAYS} days without use, so open the tree within {left} day{'s' if left != 1 else ''}: {APP}\n"
            "(This daily check probably counts as use and keeps it awake, but don't rely on that alone.)")
    if monday and (backup_age is None or backup_age >= BACKUP_DAYS):
        reasons.append(
            ("No backup of the shared tree has been exported yet." if backup_age is None
             else f"The last backup was exported {backup_age} days ago.")
            + "\nOpen the shared tree, then Archive -> Export archive (.zip). The free plan keeps no\n"
              "automatic backups, so this file is your safety copy (photos and recordings included).")

    trees = "\n".join(
        f"  - {t['name']}: {t['people']} people, {t['members']} with access, last edit {local(parse(t.get('last_edit')))}"
        for t in report.get("trees", [])) or "  (no shared trees yet)"
    status = (
        "Activity log\n"
        f"  You last signed in:      {local(owner_sign_in)}\n"
        f"  You last opened it:      {local(owner_visit)}\n"
        f"  Anyone last signed in:   {local(last_sign_in)}\n"
        f"  Anyone last opened it:   {local(last_visit)}\n"
        f"  Last edit by anyone:     {local(last_edit)}\n"
        f"  Last backup exported:    {local(last_export)}\n"
        + (f"  Would pause around:      {local(activity + timedelta(days=PAUSE_DAYS))} if nothing used it\n" if activity else "")
        + f"\nShared trees\n{trees}\n\nOpen the tree: {APP}\n"
    )

    if reasons:
        subject = "Family tree: " + ("open it soon so it doesn't pause" if idle in WARN_ON else "time for a backup")
        send(subject, "\n\n".join(reasons) + "\n\n" + status)
    elif monday or TEST:
        send("Family tree: weekly status" + (" (test)" if TEST else ""), "All good: nothing needs doing.\n\n" + status)
    else:
        print("Nothing to send today.\n" + status)
    return 0


if __name__ == "__main__":
    sys.exit(main())
