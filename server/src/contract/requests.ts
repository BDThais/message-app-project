// Request bodies as they go over the wire: snake_case keys, as api.doc.md says. Every field is
// listed with the type a valid request has; what the server does with a request that does not
// match (which rule fails first, the error text) is in api.doc.md and in the validators.
//
// Only the account bodies are here so far: the other modules add theirs when their validators
// read their bodies through these types (see `bodyFields` in lib/validation.ts).

export interface SignupBody {
  name: string;
  email: string;
  tel: string;
  password: string;
}

export interface LoginBody {
  email: string;
  password: string;
}

/** At least one of the two. `avatar_url: null` clears the avatar. */
export interface UpdateProfileBody {
  name?: string;
  avatar_url?: string | null;
}

export interface ChangePasswordBody {
  current_password: string;
  new_password: string;
}

export interface DeleteAccountBody {
  password: string;
}

export interface VerifyEmailBody {
  token: string;
}

export interface PasswordResetRequestBody {
  email: string;
}

export interface ResetPasswordBody {
  token: string;
  new_password: string;
}
