import { describe, expect, it, vi } from "vitest";
import { sendEmail } from "./email-service.js";

describe("sendEmail", () => {
  it("sends email via provided transport", async () => {
    const sendMail = vi.fn().mockResolvedValue(undefined);
    const transportFactory = vi.fn().mockReturnValue({ sendMail });

    await sendEmail(
      {
        smtpUser: "sender@gmail.com",
        smtpAppPassword: "app-password",
        to: "recipient@example.com",
        subject: "Subject",
        html: "<p>Body</p>",
        text: "Body",
      },
      transportFactory
    );

    expect(transportFactory).toHaveBeenCalledWith("sender@gmail.com", "app-password");
    expect(sendMail).toHaveBeenCalledTimes(1);
  });

  it("throws on missing required fields", async () => {
    await expect(
      sendEmail({
        smtpUser: "",
        smtpAppPassword: "",
        to: "",
        subject: "",
        html: "",
        text: "",
      })
    ).rejects.toThrow("Missing required email fields");
  });
});
