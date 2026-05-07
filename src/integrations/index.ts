// Google Auth
export { getAccessToken, isGoogleConfigured } from "./google-auth";

// Gmail
export {
  getUnreadEmails,
  searchEmails,
  getEmailBody,
  getThread,
  createDraft,
  getMyEmail,
} from "./gmail";
export type { EmailSummary, ThreadMessage, AttachmentInfo } from "./gmail";

// Google Calendar
export {
  getEvents,
  createEvent,
  updateEvent,
  deleteEvent,
  getFreeBusy,
} from "./google-calendar";
export type {
  CalendarEvent,
  CreateEventParams,
  CreatedEvent,
  FreeBusySlot,
} from "./google-calendar";

// Slack
export {
  sendMessage as slackSendMessage,
  getChannelHistory,
  searchMessages as slackSearchMessages,
  uploadFile,
  isSlackConfigured,
} from "./slack";
export type { SlackMessage, SlackFileInfo } from "./slack";

// Telegram
export {
  sendMessage as telegramSendMessage,
  getUpdates,
  getMe,
  isTelegramConfigured,
} from "./telegram";
export type {
  TelegramUpdate,
  TelegramUser,
  TelegramMessage,
  TelegramChat,
} from "./telegram";
