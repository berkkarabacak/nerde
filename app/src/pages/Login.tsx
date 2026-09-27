// Login — /login. Sign in / Sign up tabs, inline errors, ?next= redirect.
import { useEffect, useState } from 'react';
import { Link, useNavigate, useSearchParams } from 'react-router-dom';
import { Loader2 } from 'lucide-react';
import { toast } from 'sonner';
import EmptyState from '@/components/EmptyState';
import Footer from '@/components/Footer';
import { Logo } from '@/components/Header';
import OfflineBanner from '@/components/OfflineBanner';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { api, ApiRequestError } from '@/lib/api';
import { useAuth } from '@/lib/auth';
import { isDemo } from '@/lib/demo';
import { setMeta } from '@/lib/seo';
import { strings } from '@/lib/strings';

export default function Login() {
  const navigate = useNavigate();
  const [params] = useSearchParams();
  const { user, setUser } = useAuth();

  const next = params.get('next') ?? '/';

  const [signInEmail, setSignInEmail] = useState('');
  const [signInPassword, setSignInPassword] = useState('');
  const [signUpEmail, setSignUpEmail] = useState('');
  const [signUpUsername, setSignUpUsername] = useState('');
  const [signUpPassword, setSignUpPassword] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  // Google login (P1-01) is shown only when the server reports it configured;
  // any failure/absence keeps the button hidden.
  const [googleEnabled, setGoogleEnabled] = useState(false);

  useEffect(() => {
    if (isDemo) return; // no auth endpoints on static hosting
    let cancelled = false;
    fetch('/api/auth/providers')
      .then((res) => (res.ok ? res.json() : null))
      .then((data: { google?: boolean } | null) => {
        if (!cancelled && data?.google === true) setGoogleEnabled(true);
      })
      .catch(() => {
        // Hidden by default — nothing to do.
      });
    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    setMeta({
      title: 'Log in — Nerde',
      robots: 'noindex,follow',
      canonical: '/login',
      jsonLd: null,
    });
  }, []);

  // Already logged in → bounce.
  useEffect(() => {
    if (user) navigate(next, { replace: true });
  }, [user, navigate, next]);

  const submitSignIn = async () => {
    if (busy) return;
    setBusy(true);
    setError(null);
    try {
      const res = await api.login(signInEmail.trim(), signInPassword);
      setUser(res.user);
      toast.success(`Welcome back, @${res.user.username}`);
      navigate(next, { replace: true });
    } catch (err) {
      setError(err instanceof ApiRequestError ? err.message : strings.errors.generic);
    } finally {
      setBusy(false);
    }
  };

  const submitSignUp = async () => {
    if (busy) return;
    setBusy(true);
    setError(null);
    try {
      const res = await api.signup(signUpEmail.trim(), signUpUsername.trim(), signUpPassword);
      setUser(res.user);
      toast.success(`Welcome to Nerde, @${res.user.username} 🎉`);
      navigate(next, { replace: true });
    } catch (err) {
      setError(err instanceof ApiRequestError ? err.message : strings.errors.generic);
    } finally {
      setBusy(false);
    }
  };

  // Demo build: accounts don't exist on static hosting — show an honest state.
  if (isDemo) {
    return (
      <div className="flex min-h-[100dvh] flex-col bg-neutral-50">
        <OfflineBanner />
        <header className="flex h-14 shrink-0 items-center border-b border-neutral-200 bg-white px-4">
          <Logo />
        </header>
        <main className="flex flex-1 items-center justify-center p-4">
          <EmptyState
            emoji="🔒"
            title="Accounts are disabled in this demo build"
            body="Browse the full map freely — sign-in and contributions only work on the live site."
            action={
              <Button asChild>
                <Link to="/">{strings.errors.backToMap}</Link>
              </Button>
            }
          />
        </main>
        <Footer />
      </div>
    );
  }

  return (
    <div className="flex min-h-[100dvh] flex-col bg-neutral-50">
      <OfflineBanner />
      <header className="flex h-14 shrink-0 items-center border-b border-neutral-200 bg-white px-4">
        <Logo />
      </header>

      <main className="flex flex-1 flex-col items-center justify-center p-4">
        <p className="mb-4 max-w-sm text-center text-sm text-neutral-600">{strings.auth.pitch}</p>
        <div className="w-full max-w-sm rounded-lg border border-neutral-200 bg-white p-6 shadow-sm">
          {googleEnabled && (
            <>
              <Button asChild variant="outline" className="w-full">
                {/* Full-page navigation: the server 302s to Google consent. */}
                <a href="/api/auth/google">Continue with Google</a>
              </Button>
              <div className="my-4 flex items-center gap-3" aria-hidden="true">
                <div className="h-px flex-1 bg-neutral-200" />
                <span className="text-xs text-neutral-400">or</span>
                <div className="h-px flex-1 bg-neutral-200" />
              </div>
            </>
          )}
          <Tabs defaultValue="signin" onValueChange={() => setError(null)}>
            <TabsList className="grid w-full grid-cols-2">
              <TabsTrigger value="signin">{strings.auth.signIn}</TabsTrigger>
              <TabsTrigger value="signup">{strings.auth.signUp}</TabsTrigger>
            </TabsList>

            <TabsContent value="signin">
              <form
                className="mt-4 space-y-4"
                onSubmit={(e) => {
                  e.preventDefault();
                  void submitSignIn();
                }}
              >
                <div className="space-y-1.5">
                  <Label htmlFor="signin-email">{strings.auth.email}</Label>
                  <Input
                    id="signin-email"
                    type="email"
                    autoComplete="email"
                    required
                    value={signInEmail}
                    onChange={(e) => setSignInEmail(e.target.value)}
                  />
                </div>
                <div className="space-y-1.5">
                  <Label htmlFor="signin-password">{strings.auth.password}</Label>
                  <Input
                    id="signin-password"
                    type="password"
                    autoComplete="current-password"
                    required
                    value={signInPassword}
                    onChange={(e) => setSignInPassword(e.target.value)}
                  />
                </div>
                {error && (
                  <p className="text-xs text-red-600" role="alert">
                    {error}
                  </p>
                )}
                <Button type="submit" className="w-full" disabled={busy}>
                  {busy && <Loader2 aria-hidden="true" className="mr-1.5 h-4 w-4 animate-spin" />}
                  {strings.auth.signIn}
                </Button>
              </form>
            </TabsContent>

            <TabsContent value="signup">
              <form
                className="mt-4 space-y-4"
                onSubmit={(e) => {
                  e.preventDefault();
                  void submitSignUp();
                }}
              >
                <div className="space-y-1.5">
                  <Label htmlFor="signup-email">{strings.auth.email}</Label>
                  <Input
                    id="signup-email"
                    type="email"
                    autoComplete="email"
                    required
                    value={signUpEmail}
                    onChange={(e) => setSignUpEmail(e.target.value)}
                  />
                </div>
                <div className="space-y-1.5">
                  <Label htmlFor="signup-username">{strings.auth.username}</Label>
                  <Input
                    id="signup-username"
                    autoComplete="username"
                    required
                    minLength={2}
                    maxLength={30}
                    value={signUpUsername}
                    onChange={(e) => setSignUpUsername(e.target.value)}
                  />
                </div>
                <div className="space-y-1.5">
                  <Label htmlFor="signup-password">{strings.auth.password}</Label>
                  <Input
                    id="signup-password"
                    type="password"
                    autoComplete="new-password"
                    required
                    minLength={8}
                    value={signUpPassword}
                    onChange={(e) => setSignUpPassword(e.target.value)}
                  />
                </div>
                {error && (
                  <p className="text-xs text-red-600" role="alert">
                    {error}
                  </p>
                )}
                <Button type="submit" className="w-full" disabled={busy}>
                  {busy && <Loader2 aria-hidden="true" className="mr-1.5 h-4 w-4 animate-spin" />}
                  {strings.auth.signUp}
                </Button>
              </form>
            </TabsContent>
          </Tabs>
        </div>
        <Button asChild variant="ghost" size="sm" className="mt-4">
          <Link to="/">{strings.errors.backToMap}</Link>
        </Button>
      </main>

      <Footer />
    </div>
  );
}
