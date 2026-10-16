// Hints for the forms. The rules themselves are the server's (see the account section of
// api.doc.md); these texts only save a round trip, and the server's own error is what gets shown.

export const PASSWORD_HINT =
  'At least 8 characters, with an upper-case letter, a lower-case letter, a digit and a special character.';

/** The server matches an email address exactly, case included, at login and at password reset. */
export const EMAIL_CASE_HINT = 'Capital letters count: type it the way you signed up.';
