"""Generates the product illustrations (HTML) rendered to /shots/*.webp.

Two kinds:
  dash-<app>.html  full dashboard composition for the product explorer (1200 x 750)
  card-<app>.html  the product as a whole, three of its parts together, for the
                   "One suite" cards (1200 x 720)
Figures are Greenfield Public School's real sample data; every tile names a real page.
Run: python gen.py, then render.mjs with the names it prints.
"""
import os
HERE = os.path.dirname(os.path.abspath(__file__))

I = {  # 24px line icons
 "cal": '<path d="M8 3v3M16 3v3M4 9h16M5 5h14a1 1 0 0 1 1 1v13a1 1 0 0 1-1 1H5a1 1 0 0 1-1-1V6a1 1 0 0 1 1-1Z"/><path d="m9 14 2 2 4-4"/>',
 "rupee": '<rect x="3" y="6" width="18" height="12" rx="2"/><path d="M9 10h6M9 12.5h6M10 10c2 0 2.8.8 2.8 2s-.8 2-2.8 2h1l3 2.5"/>',
 "doc": '<path d="M5 4h11l3 3v13H5z"/><path d="M8 11h8M8 14h8M8 17h5"/>',
 "mega": '<path d="M4 10v4l11 4V6z"/><path d="M15 9a3 3 0 0 1 0 6M7 14.5l1 4.5h3"/>',
 "useradd": '<circle cx="10" cy="8" r="3.5"/><path d="M3.5 19c.7-3.4 3.2-5 6.5-5 1.2 0 2.3.2 3.2.6M18 14v6M15 17h6"/>',
 "clock": '<circle cx="12" cy="12" r="8.5"/><path d="M12 7v5l3 2"/>',
 "bus": '<rect x="4" y="4" width="16" height="13" rx="2"/><path d="M4 11h16M8 20v-3M16 20v-3M7.5 14h1M15.5 14h1"/>',
 "book": '<path d="M12 7c-2-1.6-4.6-2.4-8-2.4v13c3.4 0 6 .8 8 2.4 2-1.6 4.6-2.4 8-2.4v-13c-3.4 0-6 .8-8 2.4Z"/><path d="M12 7v13"/>',
 "users": '<circle cx="9" cy="8" r="3.2"/><path d="M3.5 19c.6-3 2.8-4.6 5.5-4.6s4.9 1.6 5.5 4.6"/><path d="M16 5.5a3 3 0 0 1 0 5.6M18 14.8c1.4.6 2.3 2 2.6 4.2"/>',
 "check": '<circle cx="12" cy="12" r="8.5"/><path d="m8.5 12 2.5 2.5 4.5-5"/>',
 "org": '<rect x="9" y="3" width="6" height="5" rx="1"/><rect x="3" y="16" width="6" height="5" rx="1"/><rect x="15" y="16" width="6" height="5" rx="1"/><path d="M12 8v4M6 16v-4h12v4"/>',
 "sliders": '<path d="M4 7h10M18 7h2M4 17h4M12 17h8"/><circle cx="16" cy="7" r="2"/><circle cx="10" cy="17" r="2"/>',
 "in": '<path d="M14 4h5v16h-5"/><path d="M3 12h11M10 8l4 4-4 4"/>',
 "out": '<path d="M10 4H5v16h5"/><path d="M10 12h11M17 8l4 4-4 4"/>',
 "journal": '<rect x="5" y="3" width="14" height="18" rx="1.5"/><path d="M9 8h6M9 12h6M9 16h4"/>',
 "ledger": '<path d="M4 20V5M9 20V9M14 20V4M19 20v-8"/>',
 "chart": '<path d="M4 19h16"/><path d="M6 16l4-5 3 3 5-7"/>',
 "grad": '<path d="M3 10 12 6l9 4-9 4-9-4Z"/><path d="M7 12v4c0 1.3 2.2 2.5 5 2.5s5-1.2 5-2.5v-4"/>',
 "brief": '<rect x="3" y="7" width="18" height="12" rx="2"/><path d="M9 7V5h6v2M3 12h18"/>',
 "heart": '<path d="M12 20s-7-4.4-7-10a4 4 0 0 1 7-2.6A4 4 0 0 1 19 10c0 5.6-7 10-7 10Z"/>',
 "inbox": '<path d="M4 13l2.5-8h11L20 13v6H4z"/><path d="M4 13h5l1 2h4l1-2h5"/>',
 "plus": '<rect x="4" y="4" width="16" height="16" rx="2"/><path d="M12 8v8M8 12h8"/>',
 "lib": '<path d="M5 4v16M9 4v16M13 5l4 15"/>',
 "link": '<path d="M10 14a4 4 0 0 0 5.7 0l3-3a4 4 0 0 0-5.7-5.7l-1 1M14 10a4 4 0 0 0-5.7 0l-3 3a4 4 0 0 0 5.7 5.7l1-1"/>',
 "alert": '<circle cx="12" cy="12" r="8.5"/><path d="M12 7.5v5M12 16h.01"/>',
}
def ic(k, cls=""):
    return f'<svg class="{cls}" viewBox="0 0 24 24">{I[k]}</svg>'

AV = [("#ffd8cc", "#b3402a"), ("#d6ecff", "#1d5fa8"), ("#dff3e4", "#22804a"), ("#fbe5f1", "#a23a76"), ("#fff1c9", "#9a6a00"), ("#e6e3ff", "#4b45a8")]
def people(inits, hi=4):
    return "".join(f'<div class="pc{" hi" if i == hi else ""}"><i style="background:{AV[i%6][0]};color:{AV[i%6][1]}">{t}</i><em></em><em class="s"></em></div>' for i, t in enumerate(inits))

HEAD = '''<!doctype html><html lang="en"><head><meta charset="utf-8" />
<link href="https://fonts.googleapis.com/css2?family=Onest:wght@400;500;600;700&display=swap" rel="stylesheet" />
<link rel="stylesheet" href="ill.css" /></head><body>
'''

def dash(name, v, kpi_title, kpis, quick, promos, band):
    k = "".join(f"<div><b>{a}</b><span>{b}</span></div>" for a, b in kpis)
    q = "".join(f"<div>{ic(i)}{t}</div>" for i, t in quick)
    p = "".join(f'<div class="promo" style="background:var(--a{n+1})"><p>{t}</p><span class="obtn">{b}</span>{ic(i, "ghost")}</div>' for n, (t, b, i) in enumerate(promos))
    bt, bs, bb, inits = band
    html = HEAD + f'''<div class="stage" id="art" style="--stage:{v[0]}; --tint:{v[1]}; --a1:{v[2]}; --a2:{v[3]}; --band:{v[4]};">
 <div class="card">
  <div class="col"><p class="h">{kpi_title}</p><div class="kpis">{k}</div></div>
  <div class="col"><p class="h">Quick access</p><div class="quick">{q}</div><div class="promos">{p}</div></div>
  <div class="band" style="background:var(--band)"><div class="band-copy"><p class="band-t">{bt}</p><p class="band-s">{bs}</p><span class="sbtn">{bb}</span></div>
   <div class="people">{people(inits)}</div></div>
 </div></div></body></html>'''
    open(os.path.join(HERE, f"dash-{name}.html"), "w", encoding="utf-8").write(html)

def card(name, stage, accent, tiles):
    """tiles: three dicts {t: title, big, sub, viz: html} placed as one main and two side tiles."""
    def tile(d, cls):
        return f'<div class="mt {cls}"><p class="mt-h">{ic(d["i"])}{d["t"]}</p><b class="mt-big">{d["big"]}</b><p class="mt-sub">{d["sub"]}</p>{d.get("viz","")}</div>'
    html = HEAD + f'''<div class="cstage" id="art" style="--stage:{stage}; --acc:{accent};">
 {tile(tiles[0], "m1")}{tile(tiles[1], "m2")}{tile(tiles[2], "m3")}
</div></body></html>'''
    open(os.path.join(HERE, f"card-{name}.html"), "w", encoding="utf-8").write(html)

def bars(vals, labels=None):
    out = '<div class="bars">' + "".join(f'<i style="height:{v}%"></i>' for v in vals) + "</div>"
    return out
def prog(pct, label):
    return f'<div class="prog"><i style="width:{pct}%"></i></div><p class="mt-note">{label}</p>'
def chips(items):
    return '<div class="chips">' + "".join(f"<span>{c}</span>" for c in items) + "</div>"
def avrow(inits):
    return '<div class="avrow">' + "".join(f'<i style="background:{AV[n%6][0]};color:{AV[n%6][1]}">{t}</i>' for n, t in enumerate(inits)) + "</div>"
def btn(t):
    return f'<span class="mt-btn">{t}</span>'
def rows(items):
    return '<div class="mrows">' + "".join(f"<p><span>{a}</span><em>{b}</em></p>" for a, b in items) + "</div>"

# ------------------------------------------------------------------ dashboards
dash("hr", ("#d5efe8", "#f4faf8", "#134e4a", "#e8613c", "#115e59"), "Your organisation today",
     [("12", "Employees"), ("7", "Departments"), ("2", "Leave requests"), ("4", "Holidays ahead"), ("3", "On contract"), ("1", "On probation")],
     [("users", "Employees"), ("useradd", "Add employee"), ("check", "Approvals"), ("cal", "Attendance register"), ("org", "Organisation"), ("sliders", "Leave policy"), ("clock", "Leave"), ("doc", "Employee records")],
     [("2 leave requests waiting", "Review", "check"), ("Holiday calendar", "Open", "cal")],
     ("Fatima Sheikh joined as Librarian", "Library, on probation since 1 July", "View record", ["AP", "DC", "KR", "FS", "PN", "SM"]))
dash("finance", ("#dbe5fb", "#f5f8fd", "#1e3a8a", "#0f766e", "#1e40af"), "Financial year 2026-27",
     [("&#8377;1.40 L", "Cash and bank"), ("&#8377;43,064", "Owed to you"), ("&#8377;22,400", "You owe"), ("&#8377;62,200", "Surplus"), ("10", "Entries posted"), ("Balanced", "Trial balance")],
     [("doc", "New invoice"), ("in", "Record receipt"), ("journal", "New bill"), ("out", "Make payment"), ("doc", "Journal entry"), ("users", "Customers and vendors"), ("ledger", "Chart of accounts"), ("chart", "Reports")],
     [("GST summary for November", "View", "rupee"), ("&#8377;43,064 still to collect", "Receipts", "in")],
     ("Books for 2026-27 are up to date", "Profit and loss, balance sheet and ledgers", "Open reports", ["LC", "PC", "KC", "AP", "PS", "DL"]))
dash("alumni", ("#fbe5c8", "#fdf9f3", "#7c2d12", "#b45309", "#92400e"), "Your alumni network",
     [("13", "Alumni"), ("11", "Batches"), ("9", "Cities"), ("3", "Open jobs"), ("&#8377;30,000", "Raised this year"), ("1", "Upcoming event")],
     [("grad", "Directory"), ("cal", "Events"), ("brief", "Jobs"), ("mega", "News"), ("heart", "Giving"), ("users", "Alumni records"), ("doc", "Donations"), ("chart", "Reports")],
     [("Annual reunion, 25 December", "Register", "cal"), ("New library wing", "Give", "heart")],
     ("Batch of 2014", "Find classmates and reconnect", "Find classmates", ["AB", "NS", "SK", "RD", "PS", "MP"]))
dash("desk", ("#f8dbe6", "#fdf6f9", "#831843", "#be185d", "#9d174d"), "This year at the help desk",
     [("10", "Requests received"), ("5", "Resolved"), ("100%", "Resolved on time"), ("6 h", "Typical first reply"), ("2", "Grievances"), ("4", "Help articles")],
     [("plus", "Log a request"), ("inbox", "All requests"), ("alert", "Past deadline"), ("users", "Assigned to me"), ("lib", "Articles"), ("link", "Help page"), ("chart", "Reports"), ("sliders", "Settings")],
     [("Re-evaluation request needs a reply", "Open", "alert"), ("Help centre for parents", "Share link", "link")],
     ("Every parent gets a tracking link", "Follow and reply without an account", "See the help page", ["KR", "FS", "SG", "SK", "VJ", "PI"]))

# ------------------------------------------------------------------ product cards
card("campustwin", "#ffe2da", "#d92d20", [
  {"i": "cal", "t": "Attendance", "big": "89.2%", "sub": "Last 30 days", "viz": bars([72, 78, 70, 84, 80, 88, 76, 90, 86, 92])},
  {"i": "rupee", "t": "Fees", "big": "&#8377;95.1 L", "sub": "Collected this session", "viz": prog(84, "83.7% of billed")},
  {"i": "doc", "t": "Exams", "big": "300", "sub": "Assessments held", "viz": chips(["English", "Maths", "Science", "Hindi"])}])
card("hr", "#d5efe8", "#0f766e", [
  {"i": "users", "t": "Employees", "big": "12", "sub": "Across 7 departments", "viz": avrow(["KR", "SM", "NB", "AP", "PN", "FS"]) + rows([("Academics", "2"), ("Administration", "2"), ("Facilities", "2"), ("Transport", "2")])},
  {"i": "check", "t": "Leave requests", "big": "2", "sub": "Waiting for approval", "viz": btn("Review")},
  {"i": "cal", "t": "Holidays", "big": "4", "sub": "Coming up", "viz": rows([("Christmas", "25 Dec"), ("Republic Day", "26 Jan")])}])
card("finance", "#dbe5fb", "#1d4ed8", [
  {"i": "rupee", "t": "Cash and bank", "big": "&#8377;1,40,000", "sub": "Across cash and bank", "viz": bars([40, 55, 48, 62, 58, 70, 66, 78, 74, 84])},
  {"i": "in", "t": "Owed to you", "big": "&#8377;43,064", "sub": "From open invoices", "viz": btn("Record receipt")},
  {"i": "chart", "t": "Trial balance", "big": "Balanced", "sub": "1 Apr to today", "viz": rows([("Debit", "&#8377;3,40,840"), ("Credit", "&#8377;3,40,840")])}])
card("alumni", "#fbe5c8", "#b45309", [
  {"i": "grad", "t": "Alumni network", "big": "13", "sub": "From 11 batches", "viz": avrow(["TK", "MP", "PS", "IV", "SK", "AB"]) + rows([("Tanvi Kulkarni, 2019", "Edinburgh"), ("Sana Khan, 2015", "Hyderabad"), ("Ananya Bose, 2014", "Pune")])},
  {"i": "cal", "t": "Annual reunion", "big": "25 Dec", "sub": "School auditorium", "viz": btn("Register")},
  {"i": "heart", "t": "Giving", "big": "&#8377;30,000", "sub": "Raised this year", "viz": prog(60, "New library wing")}])
card("desk", "#f8dbe6", "#be185d", [
  {"i": "inbox", "t": "Requests", "big": "10", "sub": "Received this year", "viz": rows([("Requests", "5"), ("Complaints", "3"), ("Grievances", "2"), ("Resolved", "5")])},
  {"i": "clock", "t": "First reply", "big": "6 h", "sub": "Typical time", "viz": btn("Open queue")},
  {"i": "check", "t": "On time", "big": "100%", "sub": "Resolved within deadline", "viz": prog(100, "Grievances included")}])

print("dash-hr dash-finance dash-alumni dash-desk card-campustwin card-hr card-finance card-alumni card-desk")
