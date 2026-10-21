import React, { useState, useEffect } from 'react';

const API_URL = import.meta.env.VITE_API_URL || 'http://localhost:5000';

const Dashboard = ({ userId, username, onJoinTrip, onLogout, globalSocket }) => {
  const [tripId, setTripId] = useState('');
  const [pendingRequests, setPendingRequests] = useState([]);
  
  // New States
  const [history, setHistory] = useState([]);
  const [showSettings, setShowSettings] = useState(false);
  const [newUsername, setNewUsername] = useState(username);
  const [newPassword, setNewPassword] = useState('');
  
  // Create your own group
  const handleCreateGroup = async (e) => {
    e.preventDefault();
    if (!tripId.trim()) return;
    
    try {
      const res = await fetch(`${API_URL}/api/groups`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ trip_id: tripId, creator_id: userId })
      });
      const data = await res.json();
      
      if (res.ok) {
        onJoinTrip(tripId);
      } else {
        alert(data.error || "Failed to create group");
      }
    } catch (err) {
      alert("Failed to create group. Database error?");
    }
  };

  // Fetch API Logic
  useEffect(() => {
    const fetchRequests = async () => {
      try {
        const res = await fetch(`${API_URL}/api/requests?user_id=${userId}`);
        const data = await res.json();
        setPendingRequests(data);
      } catch (err) { }
    };
    
    const fetchHistory = async () => {
        try {
            const res = await fetch(`${API_URL}/api/history/${userId}`);
            const data = await res.json();
            setHistory(data);
        } catch(err) {}
    };
    
    fetchRequests();
    fetchHistory();
  }, [userId]);

  // Listen for realtime push invite
  useEffect(() => {
    if (!globalSocket) return;

    const handleReceiveInvite = (data) => {
      setPendingRequests(prev => [...prev, data]);
    };

    globalSocket.on('receive_invite', handleReceiveInvite);

    globalSocket.on('invite_cancelled', (data) => {
        setPendingRequests(prev => prev.filter(r => r.request_id !== data.request_id));
    });

    globalSocket.on('invite_accepted', (data) => {
        onJoinTrip(data.trip_id); // Immediately route to map
    });

    globalSocket.on('invite_error', (data) => alert(data.message));
    globalSocket.on('invite_success', (data) => alert(data.message));

    return () => {
      globalSocket.off('receive_invite', handleReceiveInvite);
      globalSocket.off('invite_cancelled');
      globalSocket.off('invite_accepted');
      globalSocket.off('invite_error');
      globalSocket.off('invite_success');
    };
  }, [globalSocket, onJoinTrip]);

  const resolveInvite = (requestId, action) => {
      globalSocket.emit('resolve_invite', {
          request_id: requestId,
          action: action,
          user_id: userId
      });
      // Remove from UI immediately
      setPendingRequests(prev => prev.filter(r => r.request_id !== requestId));
  };
  
  // Profile Handlers
  const handleUpdateProfile = async (e) => {
      e.preventDefault();
      try {
          const res = await fetch(`${API_URL}/api/users/${userId}`, {
              method: 'PUT',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({ username: newUsername, password: newPassword })
          });
          const data = await res.json();
          if (res.ok) {
              alert("Profile updated! Re-login if username changed.");
              setShowSettings(false);
          } else {
              alert("Error: " + data.error);
          }
      } catch (err) { alert("Error connecting"); }
  };

  const handleDeleteProfile = async () => {
      if (!window.confirm("Are you SURE you want to delete your account? All trips will be lost.")) return;
      try {
          await fetch(`${API_URL}/api/users/${userId}`, { method: 'DELETE' });
          onLogout();
      } catch (err) {}
  };
  
  const getWeeklyRidesCount = () => {
      const oneWeekAgo = new Date();
      oneWeekAgo.setDate(oneWeekAgo.getDate() - 7);
      return history.filter(h => new Date(h.created_at) >= oneWeekAgo).length;
  };

  return (
    <div className="min-h-screen bg-gray-900 text-white p-8 overflow-y-auto">
      <div className="max-w-5xl mx-auto space-y-8">
        
        {/* HEADER */}
        <header className="flex items-center justify-between border-b border-gray-800 pb-6">
            <div>
                <h1 className="text-3xl font-bold bg-clip-text text-transparent bg-gradient-to-r from-blue-400 to-emerald-400">DashBoard</h1>
                <p className="text-gray-400 mt-1">Logged in as <span className="font-mono text-white">{username}</span></p>
                <div className="mt-2 space-x-3">
                    <button onClick={() => setShowSettings(true)} className="text-xs text-blue-400 hover:text-blue-300 underline">Settings</button>
                    <button onClick={onLogout} className="text-xs text-red-500 hover:text-red-400 underline">Log Out</button>
                </div>
            </div>
            
            {/* Inbox */}
            <div className="relative group">
                <div className="bg-gray-800 hover:bg-gray-700 border border-gray-700 px-4 py-2 rounded-xl flex items-center space-x-2 cursor-pointer transition">
                    <span className="text-sm font-medium">Invites</span>
                    {pendingRequests.length > 0 && (
                        <span className="bg-red-500 text-white text-xs font-bold w-5 h-5 flex items-center justify-center rounded-full animate-pulse">
                            {pendingRequests.length}
                        </span>
                    )}
                </div>
                
                {/* Dropdown Inbox */}
                <div className="absolute right-0 mt-2 w-80 bg-gray-800 border border-gray-700 rounded-xl shadow-2xl p-4 hidden group-hover:block z-50">
                    <h3 className="text-sm font-semibold text-gray-400 mb-3 uppercase tracking-wider">Pending Requests</h3>
                    {pendingRequests.length === 0 ? (
                        <p className="text-sm text-gray-500 py-2">No new invites.</p>
                    ) : (
                        <div className="space-y-3">
                            {pendingRequests.map(req => (
                                <div key={req.request_id} className="bg-gray-900 p-3 rounded-lg border border-gray-700">
                                    <p className="text-sm">
                                        <span className="font-bold text-blue-400">{req.sender_username}</span> invited you to <span className="font-mono">{req.trip_id}</span>
                                    </p>
                                    <div className="flex space-x-2 mt-3">
                                        <button 
                                            onClick={() => resolveInvite(req.request_id, 'accept')}
                                            className="flex-1 bg-emerald-600 hover:bg-emerald-500 text-white text-xs font-semibold py-2 rounded-md transition"
                                        >
                                            Accept & Join
                                        </button>
                                        <button 
                                            onClick={() => resolveInvite(req.request_id, 'reject')}
                                            className="flex-1 bg-gray-700 hover:bg-gray-600 text-white text-xs font-semibold py-2 rounded-md transition"
                                        >
                                            Reject
                                        </button>
                                    </div>
                                </div>
                            ))}
                        </div>
                    )}
                </div>
            </div>
        </header>

        {/* SETTINGS MODAL */}
        {showSettings && (
            <div className="fixed inset-0 bg-black/80 flex items-center justify-center z-50 animate-fade-in p-4">
                <div className="bg-gray-800 max-w-md w-full p-6 rounded-2xl shadow-2xl border border-gray-700 relative">
                    <button onClick={() => setShowSettings(false)} className="absolute top-4 right-4 text-gray-400 hover:text-white">✕</button>
                    <h2 className="text-2xl font-bold mb-6">Profile Settings</h2>
                    
                    <form onSubmit={handleUpdateProfile} className="space-y-4">
                        <div>
                            <label className="block text-sm text-gray-400 mb-1">New Username</label>
                            <input type="text" value={newUsername} onChange={e => setNewUsername(e.target.value)} className="w-full bg-gray-900 border border-gray-700 rounded-lg p-3 focus:outline-none focus:border-blue-500" required />
                        </div>
                        <div>
                            <label className="block text-sm text-gray-400 mb-1">New Password (Optional, Min 4)</label>
                            <input type="password" value={newPassword} onChange={e => setNewPassword(e.target.value)} className="w-full bg-gray-900 border border-gray-700 rounded-lg p-3 focus:outline-none focus:border-blue-500" placeholder="••••••••" />
                        </div>
                        <button type="submit" className="w-full bg-blue-600 hover:bg-blue-500 py-3 rounded-lg font-bold">Update Profile</button>
                    </form>
                    
                    <hr className="border-gray-700 my-6" />
                    
                    <div className="border border-red-900 bg-red-900/10 rounded-lg p-4">
                        <h3 className="text-red-500 font-bold text-sm mb-2">Danger Zone</h3>
                        <p className="text-xs text-gray-400 mb-4">Deleting your account permanently destroys all data and historic rides you created.</p>
                        <button onClick={handleDeleteProfile} className="w-full bg-red-600/30 text-red-500 hover:bg-red-600 hover:text-white py-2 rounded-lg font-bold text-sm transition transition">Delete Account</button>
                    </div>
                </div>
            </div>
        )}

        <div className="grid grid-cols-1 md:grid-cols-3 gap-8">
            
            {/* Create Group Panel (Col 1) */}
            <div className="md:col-span-1">
                <div className="bg-gray-800 p-8 rounded-2xl border border-gray-700 shadow-xl w-full">
                    <h2 className="text-xl font-bold mb-4">Host a New Ride</h2>
                    <p className="text-gray-400 text-sm mb-6">Create a trip identifier. You'll be able to invite friends once you load into the map.</p>
                    <form onSubmit={handleCreateGroup}>
                        <label className="block text-gray-400 text-sm font-medium mb-1">Unique Trip ID</label>
                        <input 
                            type="text" 
                            value={tripId}
                            onChange={(e) => setTripId(e.target.value)}
                            className="w-full bg-gray-900 border border-gray-700 rounded-xl px-4 py-3 mb-6 focus:outline-none focus:border-blue-500 focus:ring-1 focus:ring-blue-500"
                            placeholder="e.g. valhalla-run"
                            required
                        />
                        <button 
                            type="submit" 
                            className="w-full bg-gradient-to-r from-blue-600 to-emerald-600 hover:from-blue-500 hover:to-emerald-500 text-white font-bold py-3 px-4 rounded-xl shadow-lg transition-transform transform hover:-translate-y-1"
                        >
                            Enter Map
                        </button>
                    </form>
                </div>
            </div>

            {/* Analytics & History Panel (Col 2 & 3) */}
            <div className="md:col-span-2 space-y-6">
                
                {/* Analytics Hero */}
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                    <div className="bg-gradient-to-br from-blue-900 to-gray-800 p-6 rounded-2xl border border-blue-800/50 shadow-lg relative overflow-hidden">
                        <h3 className="text-base font-semibold text-blue-200">Total Historic Rides</h3>
                        <p className="text-4xl font-bold text-white mt-2">{history.length}</p>
                        <div className="absolute top-0 right-0 p-4 opacity-10 text-6xl">🏁</div>
                    </div>
                    
                    <div className="bg-gradient-to-br from-emerald-900 to-gray-800 p-6 rounded-2xl border border-emerald-800/50 shadow-lg relative overflow-hidden">
                        <h3 className="text-base font-semibold text-emerald-200">Rides This Week</h3>
                        <p className="text-4xl font-bold text-white mt-2">{getWeeklyRidesCount()}</p>
                        <div className="absolute top-0 right-0 p-4 opacity-10 text-6xl">📈</div>
                    </div>
                </div>

                {/* Ride History List */}
                <div className="bg-gray-800 rounded-2xl border border-gray-700 shadow-xl overflow-hidden flex flex-col">
                    <div className="p-6 border-b border-gray-700">
                        <h2 className="text-xl font-bold">Ride History</h2>
                        <p className="text-gray-400 text-sm">Past groups you hosted or participated in.</p>
                    </div>
                    <div className="flex-1 max-h-[500px] overflow-y-auto">
                        {history.length === 0 ? (
                            <div className="p-8 text-center text-gray-500">
                                No completed rides found. Go host one!
                            </div>
                        ) : (
                            <div className="divide-y divide-gray-700">
                                {history.map(trip => (
                                    <div key={trip.group_id} className="p-6 hover:bg-gray-700/50 transition">
                                        <div className="flex justify-between items-start">
                                            <div>
                                                <h4 className="text-lg font-bold text-white font-mono">{trip.trip_id}</h4>
                                                <p className="text-sm text-gray-400 mt-1">Hosted by <span className={trip.creator_username === username ? "text-emerald-400" : "text-blue-400"}>{trip.creator_username === username ? "You" : trip.creator_username}</span></p>
                                            </div>
                                            <span className="text-xs font-medium bg-gray-900 text-gray-300 px-3 py-1 rounded-full border border-gray-600">
                                                {new Date(trip.created_at).toLocaleDateString()}
                                            </span>
                                        </div>
                                        <div className="mt-4 flex flex-wrap gap-2">
                                            <span className="text-xs text-gray-500 uppercase tracking-wider font-semibold">Participants:</span>
                                            {trip.participants.map(p => (
                                                <span key={`${trip.group_id}-${p}`} className="text-xs bg-gray-600/50 text-gray-200 px-2 py-1 rounded-md">
                                                    {p}
                                                </span>
                                            ))}
                                            {trip.participants.length === 0 && <span className="text-xs italic text-gray-500">None</span>}
                                        </div>
                                    </div>
                                ))}
                            </div>
                        )}
                    </div>
                </div>

            </div>
        </div>
      </div>
    </div>
  );
};

export default Dashboard;
