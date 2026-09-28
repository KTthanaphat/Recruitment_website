import type { SOURCING_CHANNELS } from "@/lib/constants";

type ChannelKey = (typeof SOURCING_CHANNELS)[number]["enabled"];

// Fixed by channel identity so ordering and weekly selection never change its color.
export const SOURCING_CHANNEL_COLORS: Record<ChannelKey, string> = {
  channel_fb: "#3B6FE8",
  channel_jobthai: "#F28C45",
  channel_jobtopgun: "#31B978",
  channel_jobdb: "#7666E4",
  channel_jobbkk: "#E76683",
  channel_linkedin: "#26A6C6",
  channel_walkin: "#23B4A4",
  channel_referral: "#B477D3",
  channel_others: "#70829A"
};

export const UNKNOWN_SOURCING_CHANNEL_COLOR = "#94A3B8";
