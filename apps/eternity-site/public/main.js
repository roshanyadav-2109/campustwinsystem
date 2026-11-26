(() => {
  const $ = (s, r = document) => r.querySelector(s);
  const $$ = (s, r = document) => Array.from(r.querySelectorAll(s));

  $("#year").textContent = new Date().getFullYear();
  if (window.TwinOrb) $$("canvas.twin-orb").forEach((c) => window.TwinOrb.mount(c));

  // Mobile menu
  const burger = $(".burger");
  burger.addEventListener("click", () => {
    const open = document.body.classList.toggle("menu-open");
    burger.setAttribute("aria-expanded", String(open));
  });
  $$(".nav > a").forEach((a) => a.addEventListener("click", () => {
    document.body.classList.remove("menu-open");
    burger.setAttribute("aria-expanded", "false");
  }));

  // Mega menus: one open at a time; close on outside click, Escape or picking a link.
  const navBtns = $$(".nav-btn");
  const closeMenus = (except) => navBtns.forEach((b) => {
    if (b === except) return;
    b.setAttribute("aria-expanded", "false");
    $("#" + b.getAttribute("aria-controls")).hidden = true;
  });
  navBtns.forEach((b) => b.addEventListener("click", (e) => {
    e.stopPropagation();
    const open = b.getAttribute("aria-expanded") !== "true";
    closeMenus(b);
    b.setAttribute("aria-expanded", String(open));
    $("#" + b.getAttribute("aria-controls")).hidden = !open;
  }));
  $$(".mega").forEach((p) => p.addEventListener("click", (e) => e.stopPropagation()));
  $$(".mega a").forEach((a) => a.addEventListener("click", () => {
    closeMenus();
    document.body.classList.remove("menu-open");
    burger.setAttribute("aria-expanded", "false");
    if (a.dataset.tab) select(a.dataset.tab);
  }));
  document.addEventListener("click", () => closeMenus());
  document.addEventListener("keydown", (e) => { if (e.key === "Escape") closeMenus(); });

  // Close the sign-in menu on outside click or Escape
  const signin = $(".signin");
  document.addEventListener("click", (e) => { if (signin.open && !signin.contains(e.target)) signin.open = false; });
  document.addEventListener("keydown", (e) => { if (e.key === "Escape") signin.open = false; });

  // Product explorer tabs
  const tabs = $$('[role="tab"]');
  const select = (id, focus) => {
    tabs.forEach((t) => {
      const on = t.dataset.tab === id;
      t.setAttribute("aria-selected", String(on));
      t.tabIndex = on ? 0 : -1;
      $("#p-" + t.dataset.tab).hidden = !on;
      if (on && focus) t.focus();
    });
  };
  tabs.forEach((t, i) => {
    t.addEventListener("click", () => select(t.dataset.tab));
    t.addEventListener("keydown", (e) => {
      const step = { ArrowDown: 1, ArrowRight: 1, ArrowUp: -1, ArrowLeft: -1 }[e.key];
      if (step) { e.preventDefault(); select(tabs[(i + step + tabs.length) % tabs.length].dataset.tab, true); }
      if (e.key === "Home") { e.preventDefault(); select(tabs[0].dataset.tab, true); }
      if (e.key === "End") { e.preventDefault(); select(tabs[tabs.length - 1].dataset.tab, true); }
    });
  });
  // Suite strip: open that product in the explorer
  $$(".s-item").forEach((a) => a.addEventListener("click", (e) => {
    e.preventDefault();
    select(a.dataset.tab);
    $("#products").scrollIntoView({ behavior: matchMedia("(prefers-reduced-motion: reduce)").matches ? "auto" : "smooth" });
    history.replaceState(null, "", "#p-" + a.dataset.tab);
  }));
  const fromHash = location.hash.match(/^#p-(\w+)$/);
  if (fromHash && $("#p-" + fromHash[1])) select(fromHash[1]);

  // Contact form: same lead inbox as the CampusTwin site
  const LEAD_TO = "https://formsubmit.co/ajax/office@neuralai.in";
  const form = $("#contactForm");
  const note = $("#formNote");
  const say = (msg, err) => { note.textContent = msg; note.classList.toggle("err", !!err); };

  form.addEventListener("submit", async (e) => {
    e.preventDefault();
    if (form._honey.value) return;
    let bad = null;
    $$("input[required]", form).forEach((i) => {
      const ok = i.value.trim() !== "" && i.checkValidity();
      i.setAttribute("aria-invalid", ok ? "false" : "true");
      if (!ok && !bad) bad = i;
    });
    if (bad) { say("Please fill in the highlighted fields", true); bad.focus(); return; }

    const products = $$("input[name=products]:checked", form).map((i) => i.value).join(", ") || "Not specified";
    const btn = $("button[type=submit]", form);
    btn.disabled = true;
    say("Sending");
    try {
      const r = await fetch(LEAD_TO, {
        method: "POST",
        headers: { "Content-Type": "application/json", Accept: "application/json" },
        body: JSON.stringify({
          _subject: "Eternity enquiry: " + form.organisation.value.trim(),
          _template: "table", _captcha: "false",
          Name: form.name.value.trim(), Organisation: form.organisation.value.trim(),
          Email: form.email.value.trim(), Mobile: form.phone.value.trim(),
          Products: products, Page: location.href,
        }),
      });
      if (!r.ok) throw new Error(String(r.status));
      form.reset();
      say("Thank you. We will reply within one working day.");
    } catch {
      say("That did not go through. Please try again in a moment.", true);
    } finally {
      btn.disabled = false;
    }
  });
})();
