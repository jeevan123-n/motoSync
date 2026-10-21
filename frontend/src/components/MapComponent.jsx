import React, { useEffect, useState, useRef } from 'react';
import { MapContainer, TileLayer, Marker, Popup, Polyline } from 'react-leaflet';
import L from 'leaflet';
import icon from 'leaflet/dist/images/marker-icon.png';
import iconShadow from 'leaflet/dist/images/marker-shadow.png';

let DefaultIcon = L.icon({
    iconUrl: icon,
    shadowUrl: iconShadow,
    iconSize: [25, 41],
    iconAnchor: [12, 41]
});
L.Marker.prototype.options.icon = DefaultIcon;

const selfIcon = new L.Icon({
  iconUrl: 'https://raw.githubusercontent.com/pointhi/leaflet-color-markers/master/img/marker-icon-2x-blue.png',
  shadowUrl: 'https://cdnjs.cloudflare.com/ajax/libs/leaflet/0.7.7/images/marker-shadow.png',
  iconSize: [25, 41],
  iconAnchor: [12, 41],
  popupAnchor: [1, -34],
  shadowSize: [41, 41]
});

const friendIcon = new L.Icon({
  iconUrl: 'https://raw.githubusercontent.com/pointhi/leaflet-color-markers/master/img/marker-icon-2x-red.png',
  shadowUrl: 'https://cdnjs.cloudflare.com/ajax/libs/leaflet/0.7.7/images/marker-shadow.png',
  iconSize: [25, 41],
  iconAnchor: [12, 41],
  popupAnchor: [1, -34],
  shadowSize: [41, 41]
});

const API_URL = import.meta.env.VITE_API_URL || 'http://localhost:5000';

const MapComponent = ({ userId, username, tripId, globalSocket, onLeaveTrip }) => {
  const [selfLocation, setSelfLocation] = useState(null);
  const [friends, setFriends] = useState({}); 
  const [selectedFriend, setSelectedFriend] = useState(null);
  const mapRef = useRef();

  // Invite state
  const [searchQuery, setSearchQuery] = useState('');
  const [searchResults, setSearchResults] = useState([]);
  const [showInvitePanel, setShowInvitePanel] = useState(false);
  const [inviteStatus, setInviteStatus] = useState({});
  const [groupInfo, setGroupInfo] = useState({ members: [], pending_requests: [] });
  const [showEndModal, setShowEndModal] = useState(false);

  const calculateDistance = (lat1, lon1, lat2, lon2) => {
    const R = 6371;
    const dLat = (lat2 - lat1) * Math.PI / 180;
    const dLon = (lon2 - lon1) * Math.PI / 180;
    const a = 
      Math.sin(dLat/2) * Math.sin(dLat/2) +
      Math.cos(lat1 * Math.PI / 180) * Math.cos(lat2 * Math.PI / 180) * 
      Math.sin(dLon/2) * Math.sin(dLon/2); 
    const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1-a)); 
    const d = R * c;
    return d.toFixed(2);
  };

  const fetchGroupInfo = async () => {
      try {
          const res = await fetch(`${API_URL}/api/groups/${tripId}/info`);
          const data = await res.json();
          if (!data.error) setGroupInfo(data);
      } catch(err) {}
  };

  useEffect(() => {
     fetchGroupInfo();
     const interval = setInterval(fetchGroupInfo, 5000); // refresh every 5s
     return () => clearInterval(interval);
  }, [tripId]);

  useEffect(() => {
    if (!globalSocket) return;

    // We pass the display name when communicating mapping changes
    globalSocket.emit('join_trip', { user_id: username, trip_id: tripId });

    const handleFriendMoved = (data) => {
      setFriends((prevFriends) => ({
        ...prevFriends,
        [data.user_id]: data
      }));
    };

    globalSocket.on('friend_location_update', handleFriendMoved);
    
    // Also listen for invite feedback while in the map
    const onInviteError = (data) => {
      alert(data.message);
      setInviteStatus(prev => ({...prev, [data.receiver_username]: null}));
    };
    const onInviteSuccess = (data) => {
        // Invite sent successfully! Status stays waiting.
    };
    const onInviteResponse = (data) => {
      setInviteStatus(prev => ({...prev, [data.receiver_username]: data.status}));
    };
      
    globalSocket.on('invite_error', onInviteError);
    globalSocket.on('invite_success', onInviteSuccess);
    globalSocket.on('invite_response', onInviteResponse);
    globalSocket.on('invite_cancelled_success', (data) => {
        setInviteStatus(prev => ({...prev, [data.receiver_username]: null}));
        fetchGroupInfo();
    });
    globalSocket.on('remove_success', () => fetchGroupInfo());
    globalSocket.on('kicked_from_trip', (data) => {
        alert(data.message);
        if (onLeaveTrip) onLeaveTrip();
    });
    globalSocket.on('trip_ended', (data) => {
        alert(data.message);
        if (onLeaveTrip) onLeaveTrip();
    });

    return () => {
      globalSocket.emit('leave_trip', { user_id: username, trip_id: tripId });
      globalSocket.off('friend_location_update', handleFriendMoved);
      globalSocket.off('invite_error', onInviteError);
      globalSocket.off('invite_success', onInviteSuccess);
      globalSocket.off('invite_response', onInviteResponse);
      globalSocket.off('invite_cancelled_success');
      globalSocket.off('remove_success');
      globalSocket.off('kicked_from_trip');
      globalSocket.off('trip_ended');
    };
  }, [globalSocket, username, tripId]);

  useEffect(() => {
    if (!('geolocation' in navigator)) {
        console.error('Geolocation is not supported');
        return;
    }

    let lastSent = 0;
    const watchId = navigator.geolocation.watchPosition(
      (position) => {
        const { latitude, longitude, speed } = position.coords;
        const now = Date.now();
        
        const locData = {
            user_id: username,
            trip_id: tripId,
            lat: latitude,
            lng: longitude,
            speed: (speed || 0) * 3.6, 
            timestamp: now
        };

        setSelfLocation(locData);

        if (globalSocket && (now - lastSent > 5000)) {
            globalSocket.emit('location_update', locData);
            lastSent = now;
        }
        
        if (mapRef.current && !selfLocation) {
             mapRef.current.setView([latitude, longitude], 14);
        }
      },
      (error) => console.error(error),
      { enableHighAccuracy: true, maximumAge: 0, timeout: 5000 }
    );

    return () => navigator.geolocation.clearWatch(watchId);
  }, [globalSocket, tripId, username, selfLocation]);

  // Search effect
  useEffect(() => {
    const search = async () => {
      if (searchQuery.length < 2) {
        setSearchResults([]);
        return;
      }
      try {
        const res = await fetch(`${API_URL}/api/users/search?q=${searchQuery}`);
        const data = await res.json();
        const filtered = data.filter(u => u.username !== username);
        setSearchResults(filtered);
      } catch (err) { }
    };
    const timeout = setTimeout(search, 300);
    return () => clearTimeout(timeout);
  }, [searchQuery, username]);

  const sendInvite = (receiverUsername) => {
      setInviteStatus(prev => ({...prev, [receiverUsername]: 'waiting'}));
      globalSocket.emit('send_invite', {
          sender_id: userId,
          sender_username: username,
          receiver_username: receiverUsername,
          trip_id: tripId
      });
  };

  const cancelInvite = (requestId) => {
      globalSocket.emit('cancel_invite', { request_id: requestId, user_id: userId });
  };
  
  const removeMember = (targetUserId) => {
      globalSocket.emit('remove_member', { target_user_id: targetUserId, user_id: userId, trip_id: tripId });
  };

  const handleSos = () => {
      alert("SOS Alert triggered! Broadcasting...");
  };

  const handleLeaveClick = () => {
      if (groupInfo.creator_id === userId) {
          setShowEndModal(true);
      } else {
          onLeaveTrip();
      }
  };

  const closeOrSaveTrip = (action) => {
      globalSocket.emit('close_or_save_trip', { action, trip_id: tripId, user_id: userId });
      setShowEndModal(false);
  };

  return (
    <div className="flex flex-col md:flex-row h-screen w-full bg-gray-900 text-white font-sans overflow-hidden">
      
      {/* Sidebar / Dashboard UI */}
      <div className="w-full md:w-80 bg-gray-800 border-r border-gray-700 flex flex-col z-20 shadow-2xl relative h-full">
        <div className="p-6 border-b border-gray-700">
            <div className="flex justify-between items-center">
                <h1 className="text-2xl font-bold bg-clip-text text-transparent bg-gradient-to-r from-blue-400 to-emerald-400">MotoSync</h1>
                <button onClick={handleLeaveClick} className="text-xs text-gray-400 hover:text-white underline inline-block">Leave Trip</button>
            </div>
            <p className="text-gray-400 text-sm mt-1">Trip ID: <span className="font-mono text-white">{tripId}</span></p>
        </div>
        
        {/* Invite Friend Section embedded in Sidebar */}
        <div className="p-4 border-b border-gray-700 bg-gray-800/50">
            <button 
                onClick={() => setShowInvitePanel(!showInvitePanel)}
                className="w-full border border-emerald-500 text-emerald-400 hover:bg-emerald-600 hover:text-white font-medium py-3 rounded-lg transition text-sm flex items-center justify-center space-x-2 shadow-lg"
            >
                <span>➕ Invite Riders</span>
            </button>
            
            {showInvitePanel && (
                <div className="mt-4 animate-fade-in">
                    <input 
                        type="text" 
                        value={searchQuery}
                        onChange={(e) => setSearchQuery(e.target.value)}
                        className="w-full bg-gray-900 border border-gray-600 rounded-lg px-3 py-2 text-sm focus:outline-none focus:border-emerald-500 shadow-inner"
                        placeholder="Search for username..."
                    />
                    <div className="mt-2 max-h-32 overflow-y-auto space-y-2 pr-1">
                        {searchResults.map(u => (
                            <div key={u.id} className="flex items-center justify-between bg-gray-900 p-2 rounded-lg border border-gray-700 text-sm">
                                <span className="font-medium">{u.username}</span>
                                <button 
                                    onClick={() => !inviteStatus[u.username] && sendInvite(u.username)}
                                    disabled={!!inviteStatus[u.username]}
                                    className={`px-3 py-1 rounded-md text-xs font-bold transition shadow ${
                                        inviteStatus[u.username] === 'waiting' ? 'bg-yellow-600 text-white' : 
                                        inviteStatus[u.username] === 'accepted' ? 'bg-emerald-600 text-white' :
                                        inviteStatus[u.username] === 'rejected' ? 'bg-red-600 text-white' :
                                        'bg-blue-600 hover:bg-blue-500 text-white'
                                    }`}
                                >
                                    {inviteStatus[u.username] === 'waiting' ? 'Waiting...' : 
                                     inviteStatus[u.username] === 'accepted' ? 'Accepted' :
                                     inviteStatus[u.username] === 'rejected' ? 'Rejected' : 'Invite'}
                                </button>
                            </div>
                        ))}
                    </div>
                </div>
            )}
        </div>

        <div className="flex-1 overflow-y-auto p-4 space-y-4">
            <h2 className="text-xs font-semibold uppercase text-gray-500 tracking-wider">Group Roster</h2>
            
            {/* Pending Invites sent by Me */}
            {groupInfo.pending_requests.filter(req => req.sender_id === userId).map(req => (
                <div key={`req-${req.request_id}`} className="bg-gray-800 p-3 rounded-lg border border-yellow-600 flex justify-between items-center opacity-70">
                    <span className="text-sm cursor-help" title="They must accept this invite in their dashboard to appear on the map.">⏳ {req.receiver_username} (Pending)</span>
                    <button onClick={() => cancelInvite(req.request_id)} className="text-xs text-red-400 hover:text-red-300 underline font-semibold">Cancel</button>
                </div>
            ))}

            {/* Official Members */}
            {groupInfo.members.map(member => {
                const isActive = friends[member.username] || (member.username === username && selfLocation);
                const locData = member.username === username ? selfLocation : friends[member.username];

                return (
                    <div 
                        key={`mem-${member.id}`} 
                        className={`bg-gray-700 p-4 rounded-xl transition duration-200 border transform 
                        ${selectedFriend?.user_id === member.username ? 'border-red-500 ring-1 ring-red-500 shadow-lg' : 'border-transparent shadow-md'}
                        ${!isActive ? 'opacity-50 grayscale' : 'hover:scale-105 cursor-pointer'} 
                        `}
                        onClick={() => { if(isActive && member.username !== username) setSelectedFriend(locData) }}
                    >
                         <div className="flex items-center justify-between">
                            <div className="flex items-center space-x-3">
                                <div className={`w-3 h-3 rounded-full ${isActive ? (member.username === username ? 'bg-blue-500 animate-pulse' : 'bg-red-500') : 'bg-gray-500'}`}></div>
                                <span className="font-medium truncate max-w-[100px] text-sm">
                                    {member.username} {member.role === 'creator' && '👑'} {member.username === username && '(You)'}
                                </span>
                            </div>
                            
                            <div className="flex items-center space-x-2">
                                {isActive && (
                                    <span className="text-xs font-mono bg-gray-900 px-2 py-1 rounded-md text-gray-300 shadow-inner">
                                        {locData.speed.toFixed(1)} km/h
                                    </span>
                                )}
                                {member.username !== username && (groupInfo.creator_id === userId || member.inviter_id === userId) && (
                                    <button onClick={(e) => { e.stopPropagation(); removeMember(member.id); }} className="text-xs font-bold text-red-500 bg-red-900/30 px-2 py-1 rounded hover:bg-red-900/60 transition">
                                        Kick
                                    </button>
                                )}
                            </div>
                        </div>
                        
                        {isActive && selfLocation && member.username !== username && (
                            <div className="mt-3 text-xs text-gray-400 flex justify-between items-center bg-gray-800 p-2 rounded shadow-inner">
                                <span>Distance:</span>
                                <span className="font-semibold text-emerald-400">
                                    {calculateDistance(selfLocation.lat, selfLocation.lng, locData.lat, locData.lng)} km
                                </span>
                            </div>
                        )}
                    </div>
                );
            })}
        </div>

        <div className="p-6 border-t border-gray-700 bg-gray-800 mt-auto hidden md:block">
            <button 
                onClick={handleSos}
                className="w-full bg-red-600 hover:bg-red-500 text-white font-bold py-3 px-4 rounded-xl shadow-[0_0_15px_rgba(220,38,38,0.4)] transition-transform transform hover:-translate-y-1"
            >
                EMERGENCY SOS
            </button>
        </div>
      </div>

      {/* Map Area */}
      <div className="flex-1 relative z-10 w-full h-[50vh] md:h-full">
        <MapContainer 
            center={[51.505, -0.09]} 
            zoom={13} 
            className="w-full h-full"
            ref={mapRef}
        >
          <TileLayer
            url="https://{s}.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}{r}.png"
            attribution='&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a>'
          />

          {selfLocation && (
             <Marker position={[selfLocation.lat, selfLocation.lng]} icon={selfIcon}>
                <Popup className="custom-popup">
                  <div className="font-semibold">You</div>
                  <div className="text-xs text-gray-500">Speed: {selfLocation.speed.toFixed(1)} km/h</div>
                </Popup>
             </Marker>
          )}

          {Object.values(friends).map(friend => (
              <Marker key={friend.user_id} position={[friend.lat, friend.lng]} icon={friendIcon}>
                  <Popup>
                    <div className="font-semibold text-red-600">{friend.user_id}</div>
                    <div className="text-xs text-gray-500">Speed: {friend.speed.toFixed(1)} km/h</div>
                  </Popup>
              </Marker>
          ))}

          {selfLocation && selectedFriend && (
             <Polyline 
                positions={[
                    [selfLocation.lat, selfLocation.lng],
                    [selectedFriend.lat, selectedFriend.lng]
                ]} 
                color="#EF4444" 
                dashArray="10, 10" 
                weight={3}
                opacity={0.8}
            />
          )}
        </MapContainer>
      </div>

      {/* END TRIP MODAL for Creators */}
      {showEndModal && (
        <div className="fixed inset-0 bg-black/80 flex items-center justify-center z-50 animate-fade-in p-4">
            <div className="bg-gray-800 max-w-sm w-full p-6 rounded-2xl shadow-2xl border border-gray-700 text-center">
                <h2 className="text-xl font-bold mb-2 text-white">End This Trip?</h2>
                <p className="text-gray-400 text-sm mb-6">As the creator, ending this trip pulls everyone out of the room. What do you want to do with the ride data?</p>
                <div className="space-y-3">
                    <button 
                        onClick={() => closeOrSaveTrip('save')}
                        className="w-full bg-emerald-600 hover:bg-emerald-500 text-white font-bold py-3 rounded-lg shadow-lg transition"
                    >
                        End & Save to History
                    </button>
                    <button 
                        onClick={() => closeOrSaveTrip('delete')}
                        className="w-full border border-red-500 text-red-500 hover:bg-red-500 hover:text-white font-bold py-3 rounded-lg shadow-lg transition"
                    >
                        End & Delete Permanently
                    </button>
                    <button 
                        onClick={() => setShowEndModal(false)}
                        className="w-full text-gray-400 hover:text-white font-bold py-2 mt-4 transition"
                    >
                        Cancel
                    </button>
                </div>
            </div>
        </div>
      )}
    </div>
  );
};

export default MapComponent;
