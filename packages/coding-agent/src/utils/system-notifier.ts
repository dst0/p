import child_process from "node:child_process";

export interface SystemNotificationOptions {
  title: string;
  message: string;
  platform?: string;
  dispatcher?: (file: string, args: string[], callback: () => void) => void;
}

export function sendSystemNotification(options: SystemNotificationOptions): void {
  if (process.env.VITEST && options.platform === undefined && options.dispatcher === undefined) {
    return;
  }
  const { title, message } = options;
  const platform = options.platform ?? process.platform;
  const exec = options.dispatcher ?? child_process.execFile;

  try {
    if (platform === "darwin") {
      const safeTitle = title.replace(/["\\]/g, "\\$&");
      const safeMessage = message.replace(/["\\]/g, "\\$&");
      const script = `display notification "${safeMessage}" with title "${safeTitle}"`;
      exec("osascript", ["-e", script], () => {});
    } else if (platform === "linux") {
      exec("notify-send", [title, message], () => {});
    } else if (platform === "win32") {
      const safeTitle = title.replace(/['\\]/g, " ");
      const safeMessage = message.replace(/['\\]/g, " ");
      const script = [
        "[Windows.UI.Notifications.ToastNotificationManager, Windows.UI.Notifications, ContentType = WindowsRuntime] > $null",
        "$template = [Windows.UI.Notifications.ToastTemplateType]::ToastText01",
        "$xml = [Windows.UI.Notifications.ToastNotificationManager]::GetTemplateContent($template)",
        `$xml.GetElementsByTagName('text')[0].AppendChild($xml.CreateTextNode('${safeTitle}: ${safeMessage}')) > $null`,
        `[Windows.UI.Notifications.ToastNotificationManager]::CreateToastNotifier('${safeTitle}').Show([Windows.UI.Notifications.ToastNotification]::new($xml))`,
      ].join("; ");
      exec("powershell.exe", ["-NoProfile", "-Command", script], () => {});
    }
  } catch {
    // Best-effort notification delivery.
  }
}
