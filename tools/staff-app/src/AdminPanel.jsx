import React, { useState, useEffect } from 'react';
import { collection, query, getDocs, doc, updateDoc, deleteDoc, where, orderBy } from 'firebase/firestore';
import { db } from './firebase';
import { CheckCircle, XCircle, Clock, Trash2, Mail, User, Building } from 'lucide-react';

const AdminPanel = () => {
  const [users, setUsers] = useState([]);
  const [loading, setLoading] = useState(true);
  const [filter, setFilter] = useState('pending'); // 'pending', 'approved', 'all'

  useEffect(() => {
    fetchUsers();
  }, [filter]);

  const fetchUsers = async () => {
    setLoading(true);
    try {
      let q;
      
      if (filter === 'pending') {
        q = query(
          collection(db, 'users'),
          where('approved', '==', false),
          orderBy('createdAt', 'desc')
        );
      } else if (filter === 'approved') {
        q = query(
          collection(db, 'users'),
          where('approved', '==', true),
          orderBy('createdAt', 'desc')
        );
      } else {
        q = query(
          collection(db, 'users'),
          orderBy('createdAt', 'desc')
        );
      }

      const querySnapshot = await getDocs(q);
      const usersData = [];
      
      querySnapshot.forEach((doc) => {
        usersData.push({
          id: doc.id,
          ...doc.data()
        });
      });

      setUsers(usersData);
    } catch (error) {
      console.error('Kullanıcılar yüklenirken hata:', error);
      alert('Kullanıcılar yüklenirken hata oluştu: ' + error.message);
    } finally {
      setLoading(false);
    }
  };

  const approveUser = async (userId) => {
    try {
      await updateDoc(doc(db, 'users', userId), {
        approved: true,
        approvedAt: new Date().toISOString()
      });
      alert('Kullanıcı başarıyla onaylandı!');
      fetchUsers();
    } catch (error) {
      console.error('Onaylama hatası:', error);
      alert('Kullanıcı onaylanırken hata oluştu: ' + error.message);
    }
  };

  const rejectUser = async (userId) => {
    if (!window.confirm('Bu kullanıcıyı reddetmek istediçinizden emin misiniz? Kullanıcı silinecek.')) {
      return;
    }

    try {
      await deleteDoc(doc(db, 'users', userId));
      alert('Kullanıcı başarıyla silindi!');
      fetchUsers();
    } catch (error) {
      console.error('Silme hatası:', error);
      alert('Kullanıcı silinirken hata oluştu: ' + error.message);
    }
  };

  const revokeApproval = async (userId) => {
    if (!window.confirm('Bu kullanıcının onayını iptal etmek istediçinizden emin misiniz?')) {
      return;
    }

    try {
      await updateDoc(doc(db, 'users', userId), {
        approved: false
      });
      alert('Kullanıcı onayı iptal edildi!');
      fetchUsers();
    } catch (error) {
      console.error('Onay iptali hatası:', error);
      alert('Onay iptal edilirken hata oluştu: ' + error.message);
    }
  };

  const formatDate = (dateString) => {
    if (!dateString) return 'Bilinmiyor';
    const date = new Date(dateString);
    return date.toLocaleString('tr-TR');
  };

  return (
    <div className="min-h-screen bg-gray-50 p-8">
      <div className="max-w-7xl mx-auto">
        <div className="bg-white rounded-lg shadow-md p-6 mb-6">
          <h1 className="text-3xl font-bold text-gray-800 mb-2">Admin Paneli</h1>
          <p className="text-gray-600">Kullanıcı onay ve yönetim sistemi</p>
        </div>

        {/* Filtreler */}
        <div className="bg-white rounded-lg shadow-md p-4 mb-6">
          <div className="flex gap-2">
            <button
              onClick={() => setFilter('pending')}
              className={`px-4 py-2 rounded-lg font-medium transition ${
                filter === 'pending'
                  ? 'bg-yellow-500 text-white'
                  : 'bg-gray-100 text-gray-700 hover:bg-gray-200'
              }`}
            >
              <Clock className="inline w-4 h-4 mr-2" />
              Bekleyen ({users.filter(u => !u.approved).length})
            </button>
            <button
              onClick={() => setFilter('approved')}
              className={`px-4 py-2 rounded-lg font-medium transition ${
                filter === 'approved'
                  ? 'bg-green-500 text-white'
                  : 'bg-gray-100 text-gray-700 hover:bg-gray-200'
              }`}
            >
              <CheckCircle className="inline w-4 h-4 mr-2" />
              Onaylı ({users.filter(u => u.approved).length})
            </button>
            <button
              onClick={() => setFilter('all')}
              className={`px-4 py-2 rounded-lg font-medium transition ${
                filter === 'all'
                  ? 'bg-blue-500 text-white'
                  : 'bg-gray-100 text-gray-700 hover:bg-gray-200'
              }`}
            >
              Tımı ({users.length})
            </button>
          </div>
        </div>

        {/* Kullanıcı Listesi */}
        <div className="bg-white rounded-lg shadow-md overflow-hidden">
          {loading ? (
            <div className="p-12 text-center">
              <div className="animate-spin rounded-full h-12 w-12 border-b-4 border-blue-600 mx-auto mb-4"></div>
              <p className="text-gray-600">Yükleniyor...</p>
            </div>
          ) : users.length === 0 ? (
            <div className="p-12 text-center">
              <p className="text-gray-500 text-lg">Kullanıcı bulunamadı</p>
            </div>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full">
                <thead className="bg-gray-50 border-b">
                  <tr>
                    <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                      Durum
                    </th>
                    <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                      Kullanıcı
                    </th>
                    <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                      E-posta
                    </th>
                    <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                      ıirket
                    </th>
                    <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                      Kayıt Tarihi
                    </th>
                    <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                      İşlemler
                    </th>
                  </tr>
                </thead>
                <tbody className="bg-white divide-y divide-gray-200">
                  {users.map((user) => (
                    <tr key={user.id} className="hover:bg-gray-50">
                      <td className="px-6 py-4 whitespace-nowrap">
                        {user.approved ? (
                          <span className="inline-flex items-center px-3 py-1 rounded-full text-sm font-medium bg-green-100 text-green-800">
                            <CheckCircle className="w-4 h-4 mr-1" />
                            Onaylı
                          </span>
                        ) : (
                          <span className="inline-flex items-center px-3 py-1 rounded-full text-sm font-medium bg-yellow-100 text-yellow-800">
                            <Clock className="w-4 h-4 mr-1" />
                            Bekliyor
                          </span>
                        )}
                      </td>
                      <td className="px-6 py-4 whitespace-nowrap">
                        <div className="flex items-center">
                          <User className="w-5 h-5 text-gray-400 mr-2" />
                          <span className="text-gray-900 font-medium">{user.name || 'ısimsiz'}</span>
                        </div>
                      </td>
                      <td className="px-6 py-4 whitespace-nowrap">
                        <div className="flex items-center">
                          <Mail className="w-5 h-5 text-gray-400 mr-2" />
                          <span className="text-gray-600">{user.email}</span>
                        </div>
                      </td>
                      <td className="px-6 py-4 whitespace-nowrap">
                        {user.company ? (
                          <div className="flex items-center">
                            <Building className="w-5 h-5 text-gray-400 mr-2" />
                            <span className="text-gray-600">{user.company}</span>
                          </div>
                        ) : (
                          <span className="text-gray-400">-</span>
                        )}
                      </td>
                      <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-600">
                        {formatDate(user.createdAt)}
                      </td>
                      <td className="px-6 py-4 whitespace-nowrap text-sm">
                        <div className="flex gap-2">
                          {!user.approved ? (
                            <>
                              <button
                                onClick={() => approveUser(user.id)}
                                className="inline-flex items-center px-3 py-1 bg-green-500 hover:bg-green-600 text-white rounded-lg transition"
                                title="Onayla"
                              >
                                <CheckCircle className="w-4 h-4 mr-1" />
                                Onayla
                              </button>
                              <button
                                onClick={() => rejectUser(user.id)}
                                className="inline-flex items-center px-3 py-1 bg-red-500 hover:bg-red-600 text-white rounded-lg transition"
                                title="Reddet ve Sil"
                              >
                                <XCircle className="w-4 h-4 mr-1" />
                                Reddet
                              </button>
                            </>
                          ) : (
                            <>
                              <button
                                onClick={() => revokeApproval(user.id)}
                                className="inline-flex items-center px-3 py-1 bg-orange-500 hover:bg-orange-600 text-white rounded-lg transition"
                                title="Onayı ıptal Et"
                              >
                                <XCircle className="w-4 h-4 mr-1" />
                                ıptal
                              </button>
                              <button
                                onClick={() => rejectUser(user.id)}
                                className="inline-flex items-center px-3 py-1 bg-red-500 hover:bg-red-600 text-white rounded-lg transition"
                                title="Kullanıcıyı Sil"
                              >
                                <Trash2 className="w-4 h-4" />
                              </button>
                            </>
                          )}
                        </div>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      </div>
    </div>
  );
};

export default AdminPanel;

