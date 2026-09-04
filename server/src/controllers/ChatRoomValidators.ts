interface CreateChatRoomBody {
    type?: unknown;
    member_ids?: unknown;
    name?: unknown;
    avatar_url?: unknown;
}

type ValidRoomType = 'direct' | 'group';

type ValidationResult =
    | {
        valid: true;
        type: ValidRoomType;
        memberIds: number[];
        name?: string;
        avatarUrl?: string;
    }
    | { valid: false; error: string };

/**
 * Validates the body of POST /chatrooms and returns everything the
 * controller needs, normalized:
 * - memberIds: deduplicated, with the requester's own ID filtered out (the
 *   controller adds them back separately since their role differs by room
 *   type - always admin for direct, admin-as-creator for group).
 * - name / avatarUrl: only present when valid, camelCased to match the
 *   Prisma field names.
 */
export function validateCreateChatRoomInput(
    body: CreateChatRoomBody,
    requesterId: number
): ValidationResult {
    const { type, member_ids, name, avatar_url } = body;

    if (type !== 'direct' && type !== 'group') {
        return { valid: false, error: 'type must be "direct" or "group"' };
    }

    if (
        !Array.isArray(member_ids) ||
        member_ids.length === 0 ||
        member_ids.some((id) => !Number.isInteger(id))
    ) {
        return { valid: false, error: 'member_ids must be a non-empty array of user IDs' };
    }

    const memberIds = Array.from(new Set(member_ids as number[])).filter(
        (id) => id !== requesterId
    );

    if (memberIds.length === 0) {
        return { valid: false, error: 'member_ids must include at least one other user' };
    }

    if (type === 'direct') {
        if (memberIds.length !== 1) {
            return { valid: false, error: 'a direct chat room requires exactly one other member' };
        }
        if (name !== undefined || avatar_url !== undefined) {
            return { valid: false, error: 'direct chat rooms cannot have a name or avatar' };
        }
    }

    if (name !== undefined && (typeof name !== 'string' || name.trim().length === 0)) {
        return { valid: false, error: 'name must be a non-empty string if provided' };
    }

    if (avatar_url !== undefined && typeof avatar_url !== 'string') {
        return { valid: false, error: 'avatar_url must be a string if provided' };
    }

    return {
        valid: true,
        type,
        memberIds,
        ...(name !== undefined ? { name } : {}),
        ...(avatar_url !== undefined ? { avatarUrl: avatar_url } : {}),
    };
}