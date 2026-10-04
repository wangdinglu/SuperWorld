/** Sends sign-in emails through Resend when RESEND_API_KEY is set; otherwise logs the link (development). */
export interface Mailer {
  sendLoginLink(to: string, link: string): Promise<void>;
}

export function createMailer(): Mailer {
  const apiKey = process.env.RESEND_API_KEY;
  const from = process.env.MAIL_FROM ?? "SuperWorld <onboarding@resend.dev>";
  if (!apiKey) {
    return {
      async sendLoginLink(to, link) {
        console.log(
          JSON.stringify({
            event: "login-link",
            to,
            link,
            note: "Set RESEND_API_KEY to send real email",
          }),
        );
      },
    };
  }
  return {
    async sendLoginLink(to, link) {
      const res = await fetch("https://api.resend.com/emails", {
        method: "POST",
        headers: { Authorization: `Bearer ${apiKey}`, "Content-Type": "application/json" },
        body: JSON.stringify({
          from,
          to,
          subject: "Your SuperWorld sign-in link",
          text: `Open this link to keep your SuperWorld account on this device:\n\n${link}\n\nIt works once and expires in 30 minutes. If you didn't ask for it, ignore this email.`,
        }),
      });
      if (!res.ok) throw new Error(`Email service said ${res.status}`);
    },
  };
}
