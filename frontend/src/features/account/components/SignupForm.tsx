import { useState, type SyntheticEvent } from 'react';
import { Link } from '@tanstack/react-router';
import { TextField } from '../../../components/ui/TextField';
import { EMAIL_CASE_HINT, PASSWORD_HINT } from '../hints';
import { useSignup } from '../queries';

export function SignupForm() {
  const signup = useSignup();
  const [name, setName] = useState('');
  const [email, setEmail] = useState('');
  const [tel, setTel] = useState('');
  const [password, setPassword] = useState('');

  // Signup does not sign anyone in, so the next screen is a notice, then the login page.
  if (signup.isSuccess) return <CheckYourEmail email={signup.variables.email} />;

  function handleSubmit(event: SyntheticEvent<HTMLFormElement>) {
    event.preventDefault();
    // A trailing space after the name (autocomplete adds one) would be refused: names are letters and digits only.
    signup.mutate({ name: name.trim(), email, tel, password });
  }

  return (
    <>
      <h1>Create an account</h1>
      <form onSubmit={handleSubmit} className="form">
        <TextField
          label="Name"
          name="name"
          autoComplete="nickname"
          required
          value={name}
          onChange={(event) => setName(event.target.value)}
          hint="Letters and digits only, no spaces."
        />
        <TextField
          label="Email"
          type="email"
          name="email"
          autoComplete="username"
          required
          value={email}
          onChange={(event) => setEmail(event.target.value)}
          hint={`You will sign in with it. ${EMAIL_CASE_HINT}`}
        />
        <TextField
          label="Phone number"
          type="tel"
          name="tel"
          autoComplete="tel"
          required
          value={tel}
          onChange={(event) => setTel(event.target.value)}
          hint="International format, starting with + and the country code, for example +1 234 567 890."
        />
        <TextField
          label="Password"
          type="password"
          name="password"
          autoComplete="new-password"
          required
          value={password}
          onChange={(event) => setPassword(event.target.value)}
          hint={PASSWORD_HINT}
        />
        {signup.error && (
          <p role="alert" className="form-error">
            {signup.error.message}
          </p>
        )}
        <button type="submit" disabled={signup.isPending}>
          {signup.isPending ? 'Creating account…' : 'Create account'}
        </button>
      </form>
      <p className="form-links">
        <Link to="/login">I already have an account</Link>
      </p>
    </>
  );
}

function CheckYourEmail({ email }: { email: string }) {
  return (
    <>
      <h1>Check your email</h1>
      <p>
        Your account is created. A verification link is being sent to <strong>{email}</strong>.
      </p>
      <p>
        You can sign in right away: verifying the address is only needed to reset a forgotten password. If the mail does
        not arrive, sign in and use the button in the banner at the top of the page to send a new one.
      </p>
      <p>
        <Link to="/login">Sign in</Link>
      </p>
    </>
  );
}
