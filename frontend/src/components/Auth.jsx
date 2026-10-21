import React, { useState } from 'react';

const API_URL = import.meta.env.VITE_API_URL || 'http://localhost:5000';

const Auth = ({ onLoginSuccess }) => {
  const [isLogin, setIsLogin] = useState(true);
  
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  
  const [error, setError] = useState(null);

  const handleSubmit = async (e) => {
    e.preventDefault();
    setError(null);
    
    if (!isLogin) {
        if (password.length < 4) {
             setError("Password must be at least 4 characters");
             return;
        }
        if (password !== confirmPassword) {
             setError("Passwords do not match");
             return;
        }
    }

    const endpoint = isLogin ? '/api/login' : '/api/register';
    const payload = { username, password };
    
    try {
      const res = await fetch(`${API_URL}${endpoint}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload)
      });
      const data = await res.json();
      
      if (res.ok) {
        onLoginSuccess(data.user_id, data.username);
      } else {
        setError(data.error || 'Authentication failed');
      }
    } catch (err) {
      setError('Cannot connect to server. Is the backend running?');
    }
  };

  const toggleMode = () => {
      setIsLogin(!isLogin);
      setError(null);
      setUsername(''); setPassword(''); setConfirmPassword('');
  };

  return (
    <div className="min-h-screen bg-gray-900 flex items-center justify-center p-4 text-white font-sans">
      <div className="bg-gray-800 p-8 rounded-2xl shadow-2xl border border-gray-700 w-full max-w-md">
        <h1 className="text-4xl font-bold text-center mb-2 bg-clip-text text-transparent bg-gradient-to-r from-blue-400 to-emerald-400">
          MotoSync
        </h1>
        <p className="text-gray-400 text-center mb-8 text-sm">
          {isLogin ? 'Log in to join your crew' : 'Create an account to start riding'}
        </p>

        {error && (
          <div className="bg-red-900/50 border border-red-500 text-red-200 px-4 py-3 rounded-xl mb-6 text-sm">
            {error}
          </div>
        )}

        <form onSubmit={handleSubmit} className="space-y-5">
          <div>
            <label className="block text-gray-400 text-sm font-medium mb-1">Username</label>
            <input 
              type="text" 
              value={username}
              onChange={(e) => setUsername(e.target.value)}
              className="w-full bg-gray-900 border border-gray-700 rounded-xl px-4 py-3 focus:outline-none focus:border-blue-500 focus:ring-1 focus:ring-blue-500 transition disabled:opacity-50"
              placeholder="e.g. ghostrider"
              required
            />
          </div>
          
          <div>
            <label className="block text-gray-400 text-sm font-medium mb-1">Password</label>
            <input 
              type="password" 
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              className="w-full bg-gray-900 border border-gray-700 rounded-xl px-4 py-3 focus:outline-none focus:border-blue-500 focus:ring-1 focus:ring-blue-500 transition"
              placeholder={isLogin ? "••••••••" : "Min 4 characters"}
              required
            />
          </div>

          {!isLogin && (
            <div>
              <label className="block text-gray-400 text-sm font-medium mb-1">Confirm Password</label>
              <input 
                type="password" 
                value={confirmPassword}
                onChange={(e) => setConfirmPassword(e.target.value)}
                className="w-full bg-gray-900 border border-gray-700 rounded-xl px-4 py-3 focus:outline-none focus:border-blue-500 focus:ring-1 focus:ring-blue-500 transition"
                placeholder="Repeat password"
                required
              />
            </div>
          )}

          <button 
            type="submit" 
            className="w-full bg-gradient-to-r from-blue-600 to-emerald-600 hover:from-blue-500 hover:to-emerald-500 text-white font-bold py-3 px-4 rounded-xl shadow-lg transition-transform transform hover:-translate-y-1 focus:outline-none"
          >
            {isLogin ? 'Log In' : 'Sign Up'}
          </button>
        </form>

        <div className="mt-6 text-center">
          <button 
            onClick={toggleMode}
            className="text-gray-400 hover:text-white text-sm transition"
          >
            {isLogin ? "Don't have an account? Sign up" : 'Already have an account? Log in'}
          </button>
        </div>
      </div>
    </div>
  );
};

export default Auth;
