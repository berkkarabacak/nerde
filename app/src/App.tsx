import { Route, Routes } from 'react-router';
import { Toaster } from '@/components/ui/sonner';
import { AuthProvider } from '@/lib/auth';
import { CategoriesProvider } from '@/lib/categories';
import { useIsMobile } from '@/hooks/use-mobile';
import AddPlace from '@/pages/AddPlace';
import Admin from '@/pages/Admin';
import Login from '@/pages/Login';
import MapHome from '@/pages/MapHome';
import NotFound from '@/pages/NotFound';
import PlaceDetail from '@/pages/PlaceDetail';
import Saved from '@/pages/Saved';

export default function App() {
  const isMobile = useIsMobile();
  return (
    <AuthProvider>
      <CategoriesProvider>
        <Routes>
          <Route path="/" element={<MapHome />} />
          <Route path="/c/:slug" element={<MapHome />} />
          <Route path="/place/:slug" element={<PlaceDetail />} />
          <Route path="/add" element={<AddPlace />} />
          <Route path="/saved" element={<Saved />} />
          <Route path="/login" element={<Login />} />
          <Route path="/admin" element={<Admin />} />
          <Route path="*" element={<NotFound />} />
        </Routes>
        <Toaster
          position={isMobile ? 'top-center' : 'bottom-right'}
          toastOptions={{
            style: { background: '#fff', border: '1px solid #e5e5e5', color: '#171717' },
          }}
        />
      </CategoriesProvider>
    </AuthProvider>
  );
}
