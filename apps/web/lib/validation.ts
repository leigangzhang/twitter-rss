import { z } from "zod";

export const Preferences = z.object({
  topics: z.array(z.string()).min(1, "至少选择一个主题"),
  lang: z.enum(["zh", "orig"]),
});

export const SubscribeBody = Preferences.extend({
  email: z.email("邮箱格式不正确").transform((e) => e.trim().toLowerCase()),
});
