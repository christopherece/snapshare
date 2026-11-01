// Every "Start free / Choose … / Get a quote" button is a mailto: link, which silently does nothing
// on computers without a mail app set up. Intercept them and offer ways that work everywhere.

const EMAIL = "chris.ancheta@topitsolutions.co.nz";

const dialog = document.createElement("dialog");
dialog.className = "contact-dialog";
dialog.innerHTML = `
  <form method="dialog" class="contact-close-form"><button class="contact-close" aria-label="Close">×</button></form>
  <p class="kicker">Get in touch</p>
  <h3 class="contact-title"></h3>
  <p class="muted">Email us and we'll have your event's QR code ready the same day.</p>
  <div class="contact-email">
    <span>${EMAIL}</span>
    <button type="button" class="btn btn-ghost btn-sm contact-copy">Copy</button>
  </div>
  <div class="contact-actions">
    <a class="btn btn-primary contact-gmail" target="_blank" rel="noopener">Open in Gmail</a>
    <a class="btn btn-ghost contact-outlook" target="_blank" rel="noopener">Open in Outlook</a>
    <a class="link contact-app">Use my email app</a>
  </div>`;
document.body.append(dialog);

const $ = <T extends Element>(sel: string) => dialog.querySelector(sel) as T;
const copyBtn = $<HTMLButtonElement>(".contact-copy");

copyBtn.addEventListener("click", async () => {
  try {
    await navigator.clipboard.writeText(EMAIL);
    copyBtn.textContent = "Copied";
  } catch {
    getSelection()?.selectAllChildren($(".contact-email span"));
    copyBtn.textContent = "Press Ctrl+C";
  }
  setTimeout(() => (copyBtn.textContent = "Copy"), 2000);
});

// Clicking the dimmed backdrop closes it.
dialog.addEventListener("click", (e) => e.target === dialog && dialog.close());

document.addEventListener("click", (e) => {
  const a = (e.target as Element).closest?.<HTMLAnchorElement>('a[href^="mailto:"]');
  if (!a || dialog.contains(a) || typeof dialog.showModal !== "function") return;
  e.preventDefault();
  const subject = new URL(a.href).searchParams.get("subject") ?? "SnapShare enquiry";
  const body = "Hi Chris,\n\nEvent type:\nDate:\nRoughly how many guests:\n\n";
  const q = (s: string) => encodeURIComponent(s);
  $(".contact-title").textContent = a.textContent?.trim() || "Get in touch";
  $<HTMLAnchorElement>(".contact-gmail").href = `https://mail.google.com/mail/?view=cm&fs=1&to=${EMAIL}&su=${q(subject)}&body=${q(body)}`;
  $<HTMLAnchorElement>(".contact-outlook").href = `https://outlook.live.com/mail/0/deeplink/compose?to=${EMAIL}&subject=${q(subject)}&body=${q(body)}`;
  $<HTMLAnchorElement>(".contact-app").href = `mailto:${EMAIL}?subject=${q(subject)}&body=${q(body)}`;
  dialog.showModal();
});
