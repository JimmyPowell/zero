import { useEffect, useState, useCallback } from "react";
import { MoreHorizontal, UserPlus, Link2 } from "lucide-react";

import { Panel } from "@/components/Panel";
import { Button } from "@/components/ui/button";
import { Avatar } from "@/components/Avatar";
import { ConfirmDialog } from "@/components/ui/confirm-dialog";
import { InviteMemberDialog } from "@/components/InviteMemberDialog";
import {
  DropdownMenu,
  DropdownMenuTrigger,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
} from "@/components/ui/dropdown-menu";
import { useUi } from "@/lib/ui-store";
import { useAuth } from "@/lib/auth-store";
import { cn } from "@/lib/utils";
import { toast } from "@/lib/toast-store";
import {
  api,
  ApiError,
  type Member,
  type WorkspaceInvite,
  type InviteRole,
} from "@/lib/api-client";

function RoleBadge({ role }: { role: Member["role"] }) {
  const { t } = useUi();
  const styles: Record<Member["role"], string> = {
    owner: "bg-[#2563eb]/10 text-[#2563eb]",
    admin: "bg-emerald-500/10 text-emerald-600",
    member: "bg-muted text-muted-foreground",
  };
  return (
    <span
      className={cn(
        "flex-shrink-0 rounded-full px-2 py-0.5 text-[11px] leading-none font-medium",
        styles[role],
      )}
    >
      {t(`members.role.${role}`)}
    </span>
  );
}

export function MembersView() {
  const { t } = useUi();
  const { currentWorkspace, user, refreshWorkspaces } = useAuth();
  const wsId = currentWorkspace?.id ?? null;
  const myRole = currentWorkspace?.role ?? "member";
  const isOwner = myRole === "owner";
  const isAdmin = myRole === "owner" || myRole === "admin";

  const [members, setMembers] = useState<Member[]>([]);
  const [invites, setInvites] = useState<WorkspaceInvite[]>([]);
  const [status, setStatus] = useState<"loading" | "ready">("loading");
  const [inviteOpen, setInviteOpen] = useState(false);
  // 确认弹窗：移除/退出成员，或撤销邀请
  const [confirm, setConfirm] = useState<
    | { kind: "remove" | "leave"; member: Member }
    | { kind: "revoke"; invite: WorkspaceInvite }
    | null
  >(null);
  const [busy, setBusy] = useState(false);

  const load = useCallback(() => {
    if (!wsId) {
      setStatus("ready");
      return;
    }
    const jobs: Promise<void>[] = [
      api
        .listMembers(wsId)
        .then((r) => setMembers(r.members))
        .catch(() => {
          toast.error({ title: t("members.loadErr") });
        }),
    ];
    if (isAdmin) {
      jobs.push(
        api
          .listInvites(wsId)
          .then((r) => setInvites(r.invites))
          .catch(() => {}),
      );
    }
    void Promise.all(jobs).then(() => setStatus("ready"));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [wsId, isAdmin]);

  useEffect(() => {
    setStatus("loading");
    load();
  }, [load]);

  async function changeRole(m: Member, role: InviteRole) {
    if (!wsId) return;
    try {
      await api.updateMemberRole(wsId, m.id, role);
      setMembers((prev) =>
        prev.map((x) => (x.id === m.id ? { ...x, role } : x)),
      );
    } catch (err) {
      toast.error({
        title: err instanceof ApiError ? err.message : t("accept.err"),
      });
    }
  }

  async function doConfirm() {
    if (!wsId || !confirm) return;
    setBusy(true);
    try {
      if (confirm.kind === "revoke") {
        await api.revokeInvite(wsId, confirm.invite.id);
        setInvites((prev) =>
          prev.map((x) =>
            x.id === confirm.invite.id ? { ...x, status: "revoked" } : x,
          ),
        );
      } else {
        const target = confirm.member;
        await api.removeMember(wsId, target.id);
        if (confirm.kind === "leave") {
          // 自己退出：刷新列表，reconcile 会把当前空间切到剩余的第一个
          await refreshWorkspaces();
        } else {
          setMembers((prev) => prev.filter((x) => x.id !== target.id));
        }
      }
      setConfirm(null);
    } catch (err) {
      toast.error({
        title: err instanceof ApiError ? err.message : t("accept.err"),
      });
    } finally {
      setBusy(false);
    }
  }

  // 该行是否给「我」显示操作菜单
  function actionsFor(m: Member): {
    canPromote: boolean;
    canDemote: boolean;
    canRemove: boolean;
    canLeave: boolean;
  } {
    const isSelf = m.id === user?.id;
    return {
      // owner 可把非 owner 成员在 admin/member 间切换
      canPromote: isOwner && m.role === "member",
      canDemote: isOwner && m.role === "admin",
      // 移除他人：owner 可移除非 owner；admin 只能移除 member
      canRemove:
        !isSelf &&
        m.role !== "owner" &&
        (isOwner || (myRole === "admin" && m.role === "member")),
      // 自己退出（owner 需先转让，不给）
      canLeave: isSelf && m.role !== "owner",
    };
  }

  const confirmText =
    confirm?.kind === "revoke"
      ? t("members.revokeConfirm")
      : confirm?.kind === "leave"
        ? t("members.leaveConfirm").replace(
            "{name}",
            currentWorkspace?.name ?? "",
          )
        : confirm?.kind === "remove"
          ? t("members.removeConfirm").replace("{name}", confirm.member.name)
          : "";

  return (
    <Panel>
      <div className="mx-auto w-full max-w-[680px]">
        {/* 头部 */}
        <div className="flex items-start justify-between gap-3">
          <div>
            <h2 className="text-sm font-semibold text-foreground">
              {t("members.title")}
            </h2>
            <p className="mt-1 text-sm text-muted-foreground">
              {t("members.subtitle")}
            </p>
          </div>
          {isAdmin && wsId && (
            <Button
              size="sm"
              onClick={() => setInviteOpen(true)}
              className="flex-shrink-0 gap-1.5 bg-[#2563eb] text-white hover:bg-[#2563eb]/90"
            >
              <UserPlus className="size-4" />
              {t("members.invite")}
            </Button>
          )}
        </div>

        {status === "loading" ? (
          <div className="mt-5 flex flex-col gap-2">
            <div className="h-14 animate-pulse rounded-xl bg-muted/50" />
            <div className="h-14 animate-pulse rounded-xl bg-muted/50" />
          </div>
        ) : (
          <>
            {/* 成员数 */}
            <p className="mt-5 text-xs font-medium tracking-wide text-muted-foreground uppercase">
              {t("members.count").replace("{n}", String(members.length))}
            </p>

            {/* 成员列表 */}
            <div className="mt-2 overflow-hidden rounded-xl border border-border">
              {members.map((m, i) => {
                const isSelf = m.id === user?.id;
                const a = actionsFor(m);
                const hasMenu =
                  a.canPromote || a.canDemote || a.canRemove || a.canLeave;
                return (
                  <div
                    key={m.id}
                    className={cn(
                      "flex items-center gap-3 px-3.5 py-3",
                      i > 0 && "border-t border-border",
                    )}
                  >
                    <Avatar
                      name={m.name}
                      url={m.avatarUrl}
                      className="size-8 text-xs"
                    />
                    <div className="min-w-0 flex-1">
                      <div className="flex items-center gap-1.5">
                        <p className="truncate text-sm font-medium text-foreground">
                          {m.name}
                        </p>
                        {isSelf && (
                          <span className="rounded bg-muted px-1.5 py-0.5 text-[10px] text-muted-foreground">
                            {t("members.you")}
                          </span>
                        )}
                      </div>
                      <p className="truncate text-xs text-muted-foreground">
                        {m.email}
                      </p>
                    </div>
                    <RoleBadge role={m.role} />
                    {hasMenu ? (
                      <DropdownMenu>
                        <DropdownMenuTrigger asChild>
                          <button
                            type="button"
                            className="flex size-8 flex-shrink-0 items-center justify-center rounded-lg text-muted-foreground transition-colors hover:bg-sidebar-accent hover:text-foreground"
                          >
                            <MoreHorizontal className="size-4" />
                          </button>
                        </DropdownMenuTrigger>
                        <DropdownMenuContent align="end" className="min-w-[180px]">
                          {a.canPromote && (
                            <DropdownMenuItem
                              onSelect={() => changeRole(m, "admin")}
                            >
                              {t("members.role.admin")}
                            </DropdownMenuItem>
                          )}
                          {a.canDemote && (
                            <DropdownMenuItem
                              onSelect={() => changeRole(m, "member")}
                            >
                              {t("members.role.member")}
                            </DropdownMenuItem>
                          )}
                          {(a.canPromote || a.canDemote) &&
                            (a.canRemove || a.canLeave) && (
                              <DropdownMenuSeparator />
                            )}
                          {a.canRemove && (
                            <DropdownMenuItem
                              variant="destructive"
                              onSelect={() =>
                                setConfirm({ kind: "remove", member: m })
                              }
                            >
                              {t("members.remove")}
                            </DropdownMenuItem>
                          )}
                          {a.canLeave && (
                            <DropdownMenuItem
                              variant="destructive"
                              onSelect={() =>
                                setConfirm({ kind: "leave", member: m })
                              }
                            >
                              {t("members.leave")}
                            </DropdownMenuItem>
                          )}
                        </DropdownMenuContent>
                      </DropdownMenu>
                    ) : (
                      <span className="size-8 flex-shrink-0" />
                    )}
                  </div>
                );
              })}
            </div>

            {/* 邀请链接（仅 owner/admin）*/}
            {isAdmin && (
              <>
                <p className="mt-7 text-xs font-medium tracking-wide text-muted-foreground uppercase">
                  {t("members.pendingTitle")}
                </p>
                {invites.length === 0 ? (
                  <p className="mt-2 rounded-xl border border-dashed border-border px-4 py-6 text-center text-sm text-muted-foreground">
                    {t("members.pendingEmpty")}
                  </p>
                ) : (
                  <div className="mt-2 flex flex-col gap-2">
                    {invites.map((inv) => (
                      <InviteRow
                        key={inv.id}
                        inv={inv}
                        onRevoke={() =>
                          setConfirm({ kind: "revoke", invite: inv })
                        }
                      />
                    ))}
                  </div>
                )}
              </>
            )}
          </>
        )}
      </div>

      {wsId && (
        <InviteMemberDialog
          open={inviteOpen}
          workspaceId={wsId}
          canInviteAdmin={isOwner}
          onClose={() => setInviteOpen(false)}
          onCreated={load}
        />
      )}

      <ConfirmDialog
        open={!!confirm}
        title={
          confirm?.kind === "revoke"
            ? t("members.revoke")
            : confirm?.kind === "leave"
              ? t("members.leave")
              : t("members.remove")
        }
        description={confirmText}
        confirmText={
          confirm?.kind === "revoke" ? t("members.revoke") : t("members.remove")
        }
        cancelText={t("common.cancel")}
        destructive
        busy={busy}
        onConfirm={doConfirm}
        onCancel={() => (busy ? undefined : setConfirm(null))}
      />
    </Panel>
  );
}

function InviteRow({
  inv,
  onRevoke,
}: {
  inv: WorkspaceInvite;
  onRevoke: () => void;
}) {
  const { t } = useUi();
  const active = inv.status === "active";
  const statusStyles: Record<string, string> = {
    active: "bg-emerald-500/10 text-emerald-600",
    revoked: "bg-muted text-muted-foreground",
    expired: "bg-muted text-muted-foreground",
    used_up: "bg-muted text-muted-foreground",
  };
  const uses =
    inv.maxUses != null
      ? t("members.invUsesMax")
          .replace("{used}", String(inv.useCount))
          .replace("{max}", String(inv.maxUses))
      : t("members.invUses").replace("{used}", String(inv.useCount));
  const expiry = inv.expiresAt
    ? t("members.invExpires").replace(
        "{date}",
        new Date(inv.expiresAt).toLocaleDateString(),
      )
    : t("members.invNoExpiry");

  return (
    <div className="flex items-center gap-3 rounded-xl border border-border px-3.5 py-3">
      <span className="flex size-8 flex-shrink-0 items-center justify-center rounded-lg bg-[#2563eb]/10 text-[#2563eb]">
        <Link2 className="size-4" />
      </span>
      <div className="min-w-0 flex-1">
        <div className="flex items-center gap-2">
          <span className="text-sm font-medium text-foreground">
            {t(`members.role.${inv.role}`)}
          </span>
          <span
            className={cn(
              "rounded-full px-2 py-0.5 text-[11px] leading-none font-medium",
              statusStyles[inv.status],
            )}
          >
            {t(`members.invStatus.${inv.status}`)}
          </span>
        </div>
        <p className="mt-0.5 truncate text-xs text-muted-foreground">
          {uses} {expiry}
          {inv.createdByName
            ? ` · ${t("members.invBy").replace("{name}", inv.createdByName)}`
            : ""}
        </p>
      </div>
      {active && (
        <button
          type="button"
          onClick={onRevoke}
          className="flex-shrink-0 rounded-lg px-2.5 py-1.5 text-xs text-muted-foreground transition-colors hover:bg-destructive/10 hover:text-destructive"
        >
          {t("members.revoke")}
        </button>
      )}
    </div>
  );
}
