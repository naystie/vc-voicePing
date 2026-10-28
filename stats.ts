/*
 * Vencord, a Discord client mod
 * Copyright (c) 2026 Nays
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

import { findStoreLazy } from "@webpack";
import { RTCConnectionStore, UserStore } from "@webpack/common";

const RTCDebugStore = findStoreLazy("RTCDebugStore");

const HISTORY = 600;
const WINDOW = 10_000;

export interface Point {
    time: number;
    value: number;
}

export interface Peer {
    id: string;
    ping?: number;
    pings: Point[];
    loss?: number;
    choppy?: number;
    jitter?: number;
    delay?: number;
}

export interface Snapshot {
    connected: boolean;
    lossIn?: number;
    peers: Map<string, Peer>;
}

const empty = (): Snapshot => ({ connected: false, peers: new Map() });

let snapshot = empty();
const listeners = new Set<() => void>();

const windows = new Map<string, { time: number; values: number[]; }[]>();
const histories = new Map<string, Point[]>();
let touched = new Set<string>();

export const getSnapshot = () => snapshot;

export function subscribe(listener: () => void) {
    listeners.add(listener);
    return () => void listeners.delete(listener);
}

function publish(next: Snapshot) {
    snapshot = next;
    listeners.forEach(listener => listener());
}

export function reset() {
    windows.clear();
    histories.clear();
    if (snapshot.connected) publish(empty());
}

// counters restart with a new connection, so start over when one goes down
function growth(key: string, values: number[], now: number) {
    touched.add(key);

    let ring = windows.get(key);
    if (!ring || values.some((value, i) => value < ring!.at(-1)!.values[i])) windows.set(key, ring = []);

    ring.push({ time: now, values });
    while (ring.length > 2 && now - ring[1].time >= WINDOW) ring.shift();

    return ring.length > 1 ? values.map((value, i) => value - ring![0].values[i]) : undefined;
}

function history(key: string, value: number | undefined, now: number) {
    touched.add(key);

    let points = histories.get(key);
    if (!points) histories.set(key, points = []);
    if (value == null) return points;

    points.push({ time: now, value });
    if (points.length > HISTORY) points.shift();
    return points;
}

const percent = (part: number, whole: number, min: number) => whole >= min ? part / whole * 100 : undefined;

function readLoss(key: string, streams: any[], now: number) {
    let lost = 0, received = 0;
    for (const stream of streams) {
        lost += stream.packetsLost ?? 0;
        received += stream.packetsReceived ?? 0;
    }

    const delta = growth(key, [lost, received], now);
    // half a second of audio or less says nothing
    return delta && percent(delta[0], delta[0] + delta[1], 25);
}

function readPeer(id: string, streams: any[] = [], ping: number | undefined, now: number): Peer {
    const peer: Peer = {
        id,
        ping: ping == null ? undefined : Math.round(ping),
        pings: history(id, ping, now)
    };

    const audio = streams.find(stream => stream.type === "audio");
    if (!audio) return peer;

    const delta = growth(`choppy:${id}`, [audio.decodingPLC ?? 0, audio.decodingNormal ?? 0], now);
    peer.choppy = delta && percent(delta[0], delta[0] + delta[1], 50);
    peer.loss = readLoss(`loss:${id}`, streams, now);
    peer.jitter = audio.jitter;
    peer.delay = audio.delayEstimate;

    return peer;
}

export function update(connections: { context: string; stats: any; }[]) {
    const stats = connections.find(connection => connection.context === "default")?.stats;
    if (!stats) return reset();

    const now = Date.now();
    const me = UserStore.getCurrentUser().id;
    const inbound: Record<string, any[]> = stats.rtp?.inbound ?? {};
    const rtts = new Map<string, number>();
    for (const report of stats.transport?.receiverReports ?? []) {
        if (report.id != null) rtts.set(report.id, report.rtt);
    }

    touched = new Set();
    const next: Snapshot = { connected: true, lossIn: readLoss("in", Object.values(inbound).flat(), now), peers: new Map() };

    for (const id of new Set([me, ...rtts.keys(), ...Object.keys(inbound)])) {
        next.peers.set(id, readPeer(id, inbound[id], id === me ? RTCConnectionStore.getLastPing() : rtts.get(id), now));
    }

    next.peers.get(me)!.loss = RTCConnectionStore.getOutboundLossRate() ?? undefined;

    for (const key of windows.keys()) if (!touched.has(key)) windows.delete(key);
    for (const key of histories.keys()) if (!touched.has(key)) histories.delete(key);

    publish(next);
}

// discord keeps your last 10 minutes of ping, so your graph isn't empty after a restart
export function seed() {
    const pings = RTCDebugStore.getAllStats("default")[0]?.transport?.ping;
    if (Array.isArray(pings)) histories.set(UserStore.getCurrentUser().id, pings.slice(-HISTORY));
}
