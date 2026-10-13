import React, { useState } from 'react';
import { signInWithEmailAndPassword } from 'firebase/auth';
import { doc, getDoc } from 'firebase/firestore';
import { auth, db } from './firebase';
import { LogIn, Mail, Lock, AlertCircle, UserPlus, Zap } from 'lucide-react';

const Login = ({ onSwitchToRegister, onLoginSuccess }) => {
  const [formData, setFormData] = useState({
    email: '',
    password: ''
  });
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);

  const handleChange = (e) => {
    setFormData({
      ...formData,
      [e.target.name]: e.target.value
    });
  };

  const handleSubmit = async (e) => {
    e.preventDefault();
    setError('');
    setLoading(true);

    try {
      // Firebase Authentication ile giriş yap
      const userCredential = await signInWithEmailAndPassword(
        auth,
        formData.email,
        formData.password
      );

      // Firestore'dan kullanıcı bilgilerini al
      const userDoc = await getDoc(doc(db, 'users', userCredential.user.uid));
      
      if (userDoc.exists()) {
        const userData = userDoc.data();
        
        // Kullanıcı onaylı mı kontrol et
        if (!userData.approved) {
          setError('Hesabınız henüz onaylanmamış. Lütfen admin onayını bekleyin.');
          await auth.signOut(); // Onaysız kullanıcıyı çıkış yaptır
          setLoading(false);
          return;
        }

        // Onaylı kullanıcı - giriş başarılı
        onLoginSuccess(userData);
      } else {
        setError('Kullanıcı bilgileri bulunamadı.');
        await auth.signOut();
      }

    } catch (error) {
      console.error('Giriş hatası:', error);
      
      if (error.code === 'auth/user-not-found') {
        setError('Bu e-posta adresiyle kayıtlı kullanıcı bulunamadı!');
      } else if (error.code === 'auth/wrong-password') {
        setError('Hatalı şifre!');
      } else if (error.code === 'auth/invalid-email') {
        setError('Geçersiz e-posta adresi!');
      } else if (error.code === 'auth/invalid-credential') {
        setError('E-posta veya şifre hatalı!');
      } else {
        setError('Giriş sırasında bir hata oluştu: ' + error.message);
      }
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="min-h-screen bg-gradient-to-br from-blue-50 to-indigo-100 flex items-center justify-center p-4">
      <div className="bg-white rounded-2xl shadow-2xl p-8 w-full max-w-md">
        <div className="text-center mb-8">
          <div className="mx-auto w-20 h-20 bg-blue-600 rounded-full flex items-center justify-center mb-4">
            <Zap className="w-10 h-10 text-yellow-400" />
          </div>
          <h1 className="text-2xl font-extrabold text-blue-700 tracking-wide mb-1">VoltGuard</h1>
          <h2 className="text-xl font-bold text-gray-800">Hoş Geldiniz</h2>
          <p className="text-gray-600 mt-1">Hesabınıza giriş yapın</p>
        </div>

        {error && (
          <div className="mb-4 p-4 bg-red-50 border border-red-200 rounded-lg flex items-start gap-2">
            <AlertCircle className="w-5 h-5 text-red-600 flex-shrink-0 mt-0.5" />
            <p className="text-red-700 text-sm">{error}</p>
          </div>
        )}

        <form onSubmit={handleSubmit} className="space-y-4">
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">
              E-posta
            </label>
            <div className="relative">
              <Mail className="absolute left-3 top-1/2 transform -translate-y-1/2 text-gray-400 w-5 h-5" />
              <input
                type="email"
                name="email"
                value={formData.email}
                onChange={handleChange}
                required
                className="w-full pl-10 pr-4 py-3 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent"
                placeholder="ornek@email.com"
              />
            </div>
          </div>

          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">
              Şifre
            </label>
            <div className="relative">
              <Lock className="absolute left-3 top-1/2 transform -translate-y-1/2 text-gray-400 w-5 h-5" />
              <input
                type="password"
                name="password"
                value={formData.password}
                onChange={handleChange}
                required
                className="w-full pl-10 pr-4 py-3 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent"
                placeholder="şifrenizi girin"
              />
            </div>
          </div>

          <button
            type="submit"
            disabled={loading}
            className="w-full bg-blue-600 hover:bg-blue-700 text-white font-semibold py-3 rounded-lg transition duration-200 disabled:opacity-50 disabled:cursor-not-allowed flex items-center justify-center gap-2"
          >
            {loading ? (
              <>
                <div className="animate-spin rounded-full h-5 w-5 border-b-2 border-white"></div>
                <span>Giriş yapılıyor...</span>
              </>
            ) : (
              <>
                <LogIn className="w-5 h-5" />
                <span>Giriş Yap</span>
              </>
            )}
          </button>
        </form>

        <div className="mt-6 text-center">
          <p className="text-gray-600">
            Hesabınız yok mu?{' '}
            <button
              onClick={onSwitchToRegister}
              className="text-blue-600 hover:text-blue-700 font-semibold"
            >
              Kayıt Ol
            </button>
          </p>
        </div>

        <div className="mt-6 p-4 bg-blue-50 rounded-lg">
          <p className="text-sm text-gray-600 text-center">
            <strong className="text-blue-700">Not:</strong> Yeni kayıt olan kullanıcıların hesapları admin tarafından onaylanmalıdır.
          </p>
        </div>
      </div>
    </div>
  );
};

export default Login;

