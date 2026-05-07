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

// Google Drive
export {
  searchFiles,
  getRecentFiles,
  listFolder,
  uploadFile as driveUploadFile,
  downloadFile,
  formatFiles,
  isGoogleDriveConfigured,
} from "./google-drive";
export type { DriveFile } from "./google-drive";

// Google Contacts
export {
  searchContacts,
  listContacts,
  getContact,
  createContact,
  isContactsConfigured,
} from "./google-contacts";
export type { Contact } from "./google-contacts";

// Google Search Console
export {
  getSiteList,
  getSearchAnalytics,
  getTopQueries,
  isSearchConsoleConfigured,
} from "./search-console";
export type { SiteEntry, SearchAnalyticsResult, QueryRow } from "./search-console";

// Google Analytics 4
export {
  runReport,
  getPageViews,
  getActiveUsers,
  getTopPages,
  formatReport,
  isGA4Configured,
} from "./ga4";
export type { GA4Row } from "./ga4";

// GitHub
export {
  isGitHubConfigured,
  getRecentActivity,
  getRepositories,
  getIssues as githubGetIssues,
  getPullRequests,
  createIssue as githubCreateIssue,
  getNotifications,
} from "./github";
export type {
  GitHubRepo,
  GitHubIssue,
  GitHubPR,
  GitHubEvent,
  GitHubNotification,
} from "./github";

// Vercel
export {
  isVercelConfigured,
  getProjects,
  getDeployments,
  getDeployment,
  getEnvironmentVars,
} from "./vercel";
export type { VercelProject, VercelDeployment, VercelEnvVar } from "./vercel";

// Linear
export {
  isLinearConfigured,
  getIssues as linearGetIssues,
  getMyIssues,
  createIssue as linearCreateIssue,
  updateIssue as linearUpdateIssue,
  getTeams,
  searchIssues as linearSearchIssues,
} from "./linear";
export type { LinearIssue, LinearTeam } from "./linear";

// Supabase
export {
  isSupabaseConfigured,
  query as supabaseQuery,
  insert as supabaseInsert,
  update as supabaseUpdate,
  deleteRows as supabaseDeleteRows,
  rpc as supabaseRpc,
  sql as supabaseSql,
} from "./supabase";
export type { QueryParams as SupabaseQueryParams } from "./supabase";

// X (Twitter)
export {
  isXConfigured,
  postTweet,
  deleteTweet,
  getTimeline,
  searchTweets,
  getMe as xGetMe,
} from "./x-twitter";
export type { Tweet, XUser } from "./x-twitter";
