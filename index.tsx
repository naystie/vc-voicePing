/*
 * Vencord, a Discord client mod
 * Copyright (c) 2026 Nays
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

import { definePluginSettings } from "@api/Settings";
import { Devs } from "@utils/constants";
import definePlugin, { OptionType } from "@utils/types";
import type { User } from "@vencord/discord-types";
import { RTCConnectionStore, showToast } from "@webpack/common";
import type { ComponentType } from "react";

import { PopoutButton, SignalIcon, UserPing } from "./components";
import { getSnapshot, reset, seed, update } from "./stats";
import managedStyle from "./styles.css?managed";

export const settings = definePluginSettings({
    userPing: {
        type: OptionType.SELECT,
        description: "Ping next to people in voice",
        options: [
            { label: "Number", value: "number", default: true },
            { label: "Icon", value: "icon" },
            { label: "Off", value: "off" }
        ]
    },
    onlyHighPing: {
        type: OptionType.BOOLEAN,
        description: "Only show it when the ping is high",
        default: false
    },
    alerts: {
        type: OptionType.BOOLEAN,
        description: "Warn me when my connection gets bad",
        default: true
    },
    highPing: {
        type: OptionType.SLIDER,
        description: "High ping (ms)",
        markers: [60, 80, 100, 120, 150, 200],
        default: 120,
        stickToMarkers: true
    },
    badPing: {
        type: OptionType.SLIDER,
        description: "Bad ping (ms)",
        markers: [150, 200, 250, 300, 400],
        default: 250,
        stickToMarkers: true
    },
    badLoss: {
        type: OptionType.SLIDER,
        description: "Bad packet loss (%)",
        markers: [1, 2, 5, 10, 20],
        default: 5,
        stickToMarkers: true
    }
});

const ALERT_AFTER = 5000;
const ALERT_COOLDOWN = 2 * 60_000;

let badSince = 0;
let lastAlert = 0;

function checkConnection() {
    const { alerts, badPing, badLoss } = settings.store;
    if (!alerts) return;

    const ping = RTCConnectionStore.getLastPing() ?? 0;
    const loss = Math.max(RTCConnectionStore.getOutboundLossRate() ?? 0, getSnapshot().lossIn ?? 0);

    if (ping < badPing && loss < badLoss) {
        badSince = 0;
        return;
    }

    const now = Date.now();
    badSince ||= now;
    if (now - badSince < ALERT_AFTER || now - lastAlert < ALERT_COOLDOWN) return;

    lastAlert = now;
    showToast({
        text: ping >= badPing ? `High Ping: ${Math.round(ping)} ms` : `Packet Loss: ${Math.round(loss)}%`,
        icon: SignalIcon,
        iconColor: "var(--text-feedback-critical)"
    });
}

export default definePlugin({
    name: "VoicePing",
    description: "Shows everyone's ping in voice with details",
    authors: [Devs.Nays],
    tags: ["Voice", "Utility"],
    settings,
    managedStyle,

    patches: [
        {
            find: 'type:"RTC Connection"',
            replacement: {
                match: /(?=\(0,\i\.jsxs\)\("div",\{className:\i\.\i,children:\[[^\]]{0,40}?\.DIAGNOSTICS\)&&\(0,\i\.jsx\)\((\i\.\i),)/,
                replace: "$self.renderPopoutButton($1,arguments[0]),"
            }
        },
        {
            find: ".VOICE_PANEL}}",
            replacement: {
                match: /(?=\(0,\i\.jsx\)\(\i,\{[^{}]{0,50}isHovered:\i\}\))/,
                replace: "$self.renderUserPing(arguments[0]),"
            }
        }
    ],

    flux: {
        MEDIA_ENGINE_CONNECTION_STATS({ connectionStats }) {
            update(connectionStats);
            checkConnection();
        },
        VOICE_CHANNEL_SELECT({ channelId }) {
            if (channelId == null) reset();
        }
    },

    start: seed,
    stop: reset,

    renderPopoutButton: (Button: ComponentType<any>, props?: { closePopout?(): void; }) =>
        <PopoutButton Button={Button} closePopout={props?.closePopout} />,

    renderUserPing: (props?: { user?: User; isOverlay?: boolean; }) =>
        props?.user && !props.isOverlay && <UserPing userId={props.user.id} />
});
