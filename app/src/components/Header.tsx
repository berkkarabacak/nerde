// Header — slim top bar (h-14): logo, centered search, Saved, Add Place, user.
// Hidden on the mobile map home (floating controls take over there).
import { Link, useNavigate } from 'react-router-dom';
import { Heart, LogOut, Map, Plus, Shield, User as UserIcon } from 'lucide-react';
import { Avatar, AvatarFallback } from '@/components/ui/avatar';
import { Button } from '@/components/ui/button';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import SearchBar from '@/components/SearchBar';
import { useAuth } from '@/lib/auth';
import { strings } from '@/lib/strings';

export function Logo() {
  return (
    <Link
      to="/"
      className="flex shrink-0 items-center gap-1.5 text-lg font-semibold text-neutral-900"
      aria-label="Nerde — home"
    >
      Nerde <span aria-hidden="true">📍</span>
    </Link>
  );
}

export default function Header() {
  const { user, logout } = useAuth();
  const navigate = useNavigate();

  const initials = (user?.username ?? '?').slice(0, 2).toUpperCase();

  return (
    <header className="flex h-14 shrink-0 items-center gap-4 border-b border-neutral-200 bg-white px-4">
      <Logo />
      <div className="hidden max-w-xl flex-1 items-center md:flex">
        <SearchBar />
      </div>
      <div className="ml-auto flex items-center gap-2">
        <Button asChild variant="ghost" size="sm" className="hidden lg:inline-flex">
          <Link to="/saved">
            <Heart aria-hidden="true" className="mr-1.5 h-4 w-4" />
            Saved
          </Link>
        </Button>
        <Button asChild size="sm" className="hidden sm:inline-flex">
          <Link to="/add">
            <Plus aria-hidden="true" className="mr-1 h-4 w-4" />
            Add Place
          </Link>
        </Button>
        {user ? (
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <button
                type="button"
                aria-label={`Account menu for ${user.username}`}
                className="rounded-full focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-600 focus-visible:ring-offset-2"
              >
                <Avatar className="h-8 w-8">
                  <AvatarFallback className="bg-neutral-200 text-xs font-medium text-neutral-700">
                    {initials}
                  </AvatarFallback>
                </Avatar>
              </button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end" className="w-48">
              <DropdownMenuItem onSelect={() => navigate('/saved')}>
                <Heart aria-hidden="true" className="mr-2 h-4 w-4" /> Saved
              </DropdownMenuItem>
              <DropdownMenuItem onSelect={() => navigate('/')}>
                <Map aria-hidden="true" className="mr-2 h-4 w-4" /> Map
              </DropdownMenuItem>
              {user.role === 'admin' && (
                <DropdownMenuItem onSelect={() => navigate('/admin')}>
                  <Shield aria-hidden="true" className="mr-2 h-4 w-4" /> Admin
                </DropdownMenuItem>
              )}
              <DropdownMenuSeparator />
              <DropdownMenuItem
                onSelect={() => {
                  void logout().then(() => navigate('/'));
                }}
              >
                <LogOut aria-hidden="true" className="mr-2 h-4 w-4" /> {strings.auth.logout}
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
        ) : (
          <Button asChild variant="outline" size="sm">
            <Link to="/login">
              <UserIcon aria-hidden="true" className="mr-1.5 h-4 w-4 sm:hidden" />
              Log in
            </Link>
          </Button>
        )}
      </div>
    </header>
  );
}
