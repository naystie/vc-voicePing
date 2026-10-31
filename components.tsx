/*
 * Vencord, a Discord client mod
 * Copyright (c) 2026 Nays
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

import ErrorBoundary from "@components/ErrorBoundary";
import { Heading } from "@components/Heading";
import { Text } from "@components/Text";
import { classNameFactory } from "@utils/css";
import { classes } from "@utils/misc";
import type { RenderModalProps } from "@vencord/discord-types";
import { findComponentByCodeLazy, findStoreLazy } from "@webpack";
import { Avatar, ChannelStore, Clickable, GuildMemberStore, Modal, openModal, React, RTCConnectionStore, Tooltip, useLayoutEffect, useRef, UserStore, useState, useStateFromStores } from "@webpack/common";
import type { ComponentType } from "react";

import { settings } from ".";
import { getSnapshot, Peer, Point, Snapshot, subscribe } from "./stats";

const cl = classNameFactory("vc-voice-ping-");

const Graph = findComponentByCodeLazy("TimelineGraphView(", "hoverSource");
const FineIcon = findComponentByCodeLazy("M2 3a1 1 0 0 1 1-1 19 19 0 0 1 19 19");
const AverageIcon = findComponentByCodeLazy("M3 7a1 1 0 0 0 0 2 12 12 0 0 1 12 12");
const BadIcon = findComponentByCodeLazy("ICON_FEEDBACK_CRITICAL", "9 9 0 0 1 9 9 1 1 0 1 1-2 0 7 7 0 0 0-7-7");
const SpeakingStore = findStoreLazy("SpeakingStore");

type Level = "good" | "okay" | "poor";

const icons: Record<Level, ComponentType<any>> = { good: FineIcon, okay: AverageIcon, poor: BadIcon };
const titles: Record<Level, string> = { good: "Good connection", okay: "Unstable connection", poor: "Poor connection" };

export function pingLevel(ping: number): Level {
    const { highPing, badPing } = settings.store;
    return ping >= badPing ? "poor" : ping >= highPing ? "okay" : "good";
}

function lossLevel(loss = 0): Level {
    const { badLoss } = settings.store;
    return loss >= badLoss ? "poor" : loss >= Math.min(1, badLoss / 2) ? "okay" : "good";
}

const worst = (a: Level, b: Level) => a === "poor" || b === "poor" ? "poor" : a === "okay" || b === "okay" ? "okay" : "good";

const number = new Intl.NumberFormat("en", { maximumFractionDigits: 1 });
const ms = (value?: number | null) => value == null ? undefined : `${Math.round(value)} ms`;
const pct = (value?: number | null) => value == null ? undefined : `${number.format(value)}%`;

export const SignalIcon = (props: any) => <FineIcon {...props} color={props.color ?? "currentColor"} />;

function Signal({ level, size = "xs" }: { level: Level; size?: string; }) {
    const Icon = icons[level];
    return <Icon size={size} />;
}

function useSnapshot<T>(select: (snapshot: Snapshot) => T) {
    return React.useSyncExternalStore(subscribe, () => select(getSnapshot()));
}

function displayName(userId: string) {
    const user = UserStore.getUser(userId);
    return GuildMemberStore.getNick(RTCConnectionStore.getGuildId() ?? "", userId) ?? user?.globalName ?? user?.username ?? userId;
}

function PingGraph({ points }: { points: Point[]; }) {
    const ref = useRef<HTMLDivElement>(null);
    const [width, setWidth] = useState(0);

    useLayoutEffect(() => setWidth(ref.current!.clientWidth), []);

    return <div ref={ref} className={cl("graph")}>{width > 0 && <Graph dataPoints={points} width={width} height={96} />}</div>;
}

function Focus({ peer, name, me, lossIn }: { peer: Peer; name: string; me: boolean; lossIn?: number; }) {
    const loss = me ? Math.max(peer.loss ?? 0, lossIn ?? 0) : peer.loss;
    const level = worst(pingLevel(peer.ping ?? 0), lossLevel(loss));

    const stats: [string, string | undefined][] = me
        ? [
            ["Average", ms(RTCConnectionStore.getAveragePing())],
            ["Loss out", pct(peer.loss)],
            ["Loss in", pct(lossIn)],
            ["Server", RTCConnectionStore.getHostname().split(".")[0]]
        ]
        : [
            ["Loss", pct(peer.loss)],
            ["Choppy", pct(peer.choppy)],
            ["Jitter", ms(peer.jitter)],
            ["Delay", ms(peer.delay)]
        ];

    return (
        <div className={cl("focus")}>
            <div className={cl("focus-top")}>
                <div className={cl("focus-ping")}>
                    <Signal level={level} size="md" />
                    <Text size="xxl" weight="bold" className={cl(level)}>{peer.ping ?? "–"}</Text>
                    <Text size="sm" weight="semibold" className={cl("muted")}>ms</Text>
                </div>
                <div className={cl("focus-title")}>
                    <Text size="md" weight="semibold" className={classes(cl("strong"), cl("ellipsis"))}>{name}</Text>
                    <Text size="sm" className={cl("muted")}>{titles[level]}</Text>
                </div>
            </div>
            <PingGraph points={peer.pings} />
            <div className={cl("tiles")}>
                {stats.map(([label, value]) => (
                    <div key={label} className={cl("tile")}>
                        <Text size="xs" weight="semibold" className={classes(cl("muted"), cl("ellipsis"))}>{label}</Text>
                        <Text size="sm" weight="semibold" className={classes(cl("strong"), cl("ellipsis"))}>{value ?? "–"}</Text>
                    </div>
                ))}
            </div>
        </div>
    );
}

function PeerRow({ peer, name, selected, onSelect }: { peer: Peer; name: string; selected: boolean; onSelect(): void; }) {
    const level = peer.ping == null ? undefined : pingLevel(peer.ping);
    const loss = peer.loss == null ? "good" : lossLevel(peer.loss);
    const speaking = useStateFromStores([SpeakingStore], () => SpeakingStore.isSpeaking(peer.id));

    return (
        <Clickable className={classes(cl("peer"), selected && cl("selected"))} onClick={onSelect}>
            <Avatar
                src={UserStore.getUser(peer.id)?.getAvatarURL(RTCConnectionStore.getGuildId(), 32)}
                size="SIZE_32"
                className={classes(speaking && cl("speaking"))}
            />
            <Text size="md" weight="medium" className={classes(cl("name"), cl("ellipsis"))}>{name}</Text>
            {loss !== "good" && <Text size="xs" weight="semibold" className={cl(loss)}>{`${pct(peer.loss)} loss`}</Text>}
            {level && (
                <div className={cl("peer-ping")}>
                    <Signal level={level} />
                    <Text size="sm" weight="semibold" className={cl(level)}>{ms(peer.ping)}</Text>
                </div>
            )}
        </Clickable>
    );
}

function PingModal({ focus, ...props }: RenderModalProps & { focus?: string; }) {
    const me = UserStore.getCurrentUser().id;
    const [selected, setSelected] = useState(focus ?? me);
    const snapshot = useSnapshot(snapshot => snapshot);
    const channel = useStateFromStores([RTCConnectionStore, ChannelStore], () => ChannelStore.getChannel(RTCConnectionStore.getChannelId()!));

    const peers = [...snapshot.peers.values()]
        .map(peer => ({ peer, name: displayName(peer.id) }))
        .sort((a, b) => Number(b.peer.id === me) - Number(a.peer.id === me) || a.name.localeCompare(b.name));
    const current = peers.find(({ peer }) => peer.id === selected) ?? peers[0];

    return (
        <Modal {...props} size="md" title="Ping Details" subtitle={channel?.name}>
            {current
                ? (
                    <div className={cl("body")}>
                        <Focus {...current} me={current.peer.id === me} lossIn={snapshot.lossIn} />
                        <Heading tag="h4" className={cl("strong")}>{`In Voice — ${peers.length}`}</Heading>
                        <div className={cl("peers")}>
                            {peers.map(({ peer, name }) => (
                                <PeerRow key={peer.id} peer={peer} name={name} selected={peer === current.peer} onSelect={() => setSelected(peer.id)} />
                            ))}
                        </div>
                    </div>
                )
                : <Text size="sm" className={classes(cl("muted"), cl("empty"))}>You're not connected to voice.</Text>}
        </Modal>
    );
}

function openPingDetails(focus?: string) {
    openModal(props => <PingModal {...props} focus={focus} />);
}

export const PopoutButton = ErrorBoundary.wrap(({ Button, closePopout }: { Button: ComponentType<any>; closePopout?(): void; }) => (
    <div className={cl("popout-button")}>
        <Button
            icon={SignalIcon}
            text="Ping Details"
            variant="secondary"
            size="sm"
            fullWidth
            onClick={() => {
                closePopout?.();
                openPingDetails();
            }}
        />
    </div>
), { noop: true });

export const UserPing = ErrorBoundary.wrap(({ userId }: { userId: string; }) => {
    const { userPing, onlyHighPing } = settings.use(["userPing", "onlyHighPing", "highPing", "badPing"]);
    const ping = useSnapshot(snapshot => snapshot.peers.get(userId)?.ping);

    if (userPing === "off" || ping == null) return null;

    const level = pingLevel(ping);
    if (onlyHighPing && level === "good") return null;

    return (
        <Tooltip text={userPing === "icon" ? `${ping} ms` : null}>
            {tooltipProps => (
                <Clickable
                    {...tooltipProps}
                    className={cl("user")}
                    onClick={(event: React.MouseEvent) => {
                        event.stopPropagation();
                        openPingDetails(userId);
                    }}
                >
                    {userPing === "icon"
                        ? <Signal level={level} />
                        : <Text size="xs" weight="semibold" className={cl(level)}>{ping}</Text>}
                </Clickable>
            )}
        </Tooltip>
    );
}, { noop: true });
