import { useState, useEffect } from 'react';
import { db, auth } from './firebase';
import { collection, getCountFromServer, addDoc, serverTimestamp, query, where, getDocs, updateDoc, deleteDoc } from 'firebase/firestore';
import { createUserWithEmailAndPassword, signInWithEmailAndPassword, sendEmailVerification, signOut, onAuthStateChanged, deleteUser } from 'firebase/auth';
import bcrypt from 'bcryptjs';

// --- MAIN APP COMPONENT ---
export default function App() {
  const [showSignup, setShowSignup] = useState(false);
  const [showDashboard, setShowDashboard] = useState(false);
  const [currentUser, setCurrentUser] = useState(null);
  const [userName, setUserName] = useState('');

  // Listen for authentication state changes
  useEffect(() => {
    const unsubscribe = onAuthStateChanged(auth, async (user) => {
      if (user && user.emailVerified) {
        setCurrentUser(user);

        // Fetch user name from Firestore
        const usersRef = collection(db, 'users');
        const q = query(usersRef, where('email', '==', user.email));
        const querySnapshot = await getDocs(q);

        if (!querySnapshot.empty) {
          const userData = querySnapshot.docs[0].data();
          setUserName(userData.name || '');
        }
      } else {
        setCurrentUser(null);
        setUserName('');
      }
    });

    return () => unsubscribe();
  }, []);

  const handleGetStarted = () => {
    // If user is logged in, this won't be called as button is replaced
    // But keeping for non-logged in users
    setShowSignup(true);
  };

  const handleBackToHome = () => {
    setShowSignup(false);
  };

  const handleLogout = async () => {
    try {
      await signOut(auth);
      setCurrentUser(null);
      setUserName('');
      setShowDashboard(false);
    } catch (error) {
      console.error('Logout error:', error);
    }
  };

  const handleDeleteAccount = async () => {
    if (!currentUser) return;

    const confirmed = window.confirm(
      'Are you sure you want to delete your account? This action cannot be undone.'
    );

    if (!confirmed) return;

    try {
      // Delete user document from Firestore
      const usersRef = collection(db, 'users');
      const q = query(usersRef, where('email', '==', currentUser.email));
      const querySnapshot = await getDocs(q);

      if (!querySnapshot.empty) {
        const userDoc = querySnapshot.docs[0];
        await deleteDoc(userDoc.ref);
      }

      // Delete user from Firebase Auth
      await deleteUser(currentUser);

      // Clear state
      setCurrentUser(null);
      setUserName('');
      setShowDashboard(false);

      alert('Your account has been successfully deleted.');
    } catch (error) {
      console.error('Delete account error:', error);

      // Handle re-authentication requirement
      if (error.code === 'auth/requires-recent-login') {
        alert('For security reasons, please log out and log back in before deleting your account.');
      } else {
        alert('Failed to delete account. Please try again later.');
      }
    }
  };

  const handleStartPlanning = () => {
    if (currentUser) {
      setShowDashboard(true);
    } else {
      setShowSignup(true);
    }
  };

  const handleBackToDashboard = () => {
    setShowDashboard(false);
  };

  if (showSignup) {
    return <SignupPage onBack={handleBackToHome} />;
  }

  if (showDashboard && currentUser) {
    return <Dashboard userName={userName} currentUser={currentUser} onBack={handleBackToDashboard} onLogout={handleLogout} onDeleteAccount={handleDeleteAccount} />;
  }

  return <LandingPage onGetStarted={handleGetStarted} onStartPlanning={handleStartPlanning} currentUser={currentUser} userName={userName} onLogout={handleLogout} onDeleteAccount={handleDeleteAccount} />;
}

// --- SIGNUP PAGE COMPONENT ---
function SignupPage({ onBack }) {
  const [isLogin, setIsLogin] = useState(false);
  const [formData, setFormData] = useState({
    name: '',
    email: '',
    password: '',
    confirmPassword: ''
  });
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [success, setSuccess] = useState('');
  const [passwordFocused, setPasswordFocused] = useState(false);

  // Password validation checks
  const passwordValidations = {
    minLength: formData.password.length >= 8,
    hasUpperCase: /[A-Z]/.test(formData.password),
    hasLowerCase: /[a-z]/.test(formData.password),
    hasNumber: /[0-9]/.test(formData.password),
    hasSpecialChar: /[!@#$%^&*(),.?":{}|<>]/.test(formData.password)
  };

  const isPasswordValid = Object.values(passwordValidations).every(Boolean);

  const handleSubmit = async (e) => {
    e.preventDefault();
    setError('');
    setSuccess('');
    setLoading(true);

    try {
      if (isLogin) {
        // Login existing user
        const userCredential = await signInWithEmailAndPassword(auth, formData.email, formData.password);

        // Check if email is verified
        if (!userCredential.user.emailVerified) {
          setError('Please verify your email before logging in. Check your inbox for the verification link.');
          await auth.signOut();
          setLoading(false);
          return;
        }

        // Update isVerified to true in Firestore if email is verified
        const usersRef = collection(db, 'users');
        const q = query(usersRef, where('email', '==', formData.email));
        const querySnapshot = await getDocs(q);

        if (!querySnapshot.empty) {
          // Update the first matching document
          const userDoc = querySnapshot.docs[0];
          await updateDoc(userDoc.ref, {
            isVerified: true
          });
        }

        setSuccess('Login successful! Welcome back.');
        setTimeout(() => {
          onBack();
        }, 1500);
      } else {
        // Signup new user
        // Validate passwords match
        if (formData.password !== formData.confirmPassword) {
          setError('Passwords do not match');
          setLoading(false);
          return;
        }

        // Validate password strength
        if (!isPasswordValid) {
          setError('Password must meet all security requirements');
          setLoading(false);
          return;
        }

        // Hash the password before storing
        const salt = await bcrypt.genSalt(10);
        const hashedPassword = await bcrypt.hash(formData.password, salt);

        // Create user in Firebase Auth
        const userCredential = await createUserWithEmailAndPassword(auth, formData.email, formData.password);

        // Send email verification
        await sendEmailVerification(userCredential.user);

        // Add user to Firestore 'users' collection
        await addDoc(collection(db, 'users'), {
          name: formData.name,
          email: formData.email,
          password: hashedPassword, // Stored as hashed password
          isVerified: false,
          createdAt: serverTimestamp()
        });

        setSuccess('Account created! Please check your email to verify your account before logging in.');

        // Sign out the user until they verify their email
        await auth.signOut();

        // Clear form
        setFormData({
          name: '',
          email: '',
          password: '',
          confirmPassword: ''
        });

        // Switch to login mode after 3 seconds
        setTimeout(() => {
          setIsLogin(true);
          setSuccess('');
        }, 3000);
      }
    } catch (error) {
      console.error('Auth error:', error);

      // Handle specific error codes
      switch (error.code) {
        case 'auth/email-already-in-use':
          setError('This email is already registered. Please login instead.');
          break;
        case 'auth/invalid-email':
          setError('Invalid email address.');
          break;
        case 'auth/weak-password':
          setError('Password is too weak. Use at least 6 characters.');
          break;
        case 'auth/user-not-found':
          setError('No account found with this email.');
          break;
        case 'auth/wrong-password':
          setError('Incorrect password.');
          break;
        case 'auth/too-many-requests':
          setError('Too many failed attempts. Please try again later.');
          break;
        default:
          setError(error.message || 'An error occurred. Please try again.');
      }
    } finally {
      setLoading(false);
    }
  };

  const handleInputChange = (e) => {
    setFormData({
      ...formData,
      [e.target.name]: e.target.value
    });
  };

  return (
    <div className="min-h-screen bg-slate-900 font-sans">
      {/* Full Screen Background */}
      <div className="fixed inset-0 z-0">
        <img
          src="https://images.unsplash.com/photo-1506905925346-21bda4d32df4?auto=format&fit=crop&q=80&w=2070"
          className="w-full h-full object-cover"
          alt="Himalayas"
        />
        <div className="absolute inset-0 bg-gradient-to-br from-slate-900/80 via-slate-900/70 to-blue-900/80"></div>
      </div>

      {/* Content */}
      <div className="relative z-10 min-h-screen flex items-center justify-center px-4 py-12">
        <div className="w-full max-w-md">
          {/* Back Button */}
          <button
            onClick={onBack}
            className="mb-6 flex items-center gap-2 text-white/80 hover:text-white transition-colors group"
          >
            <svg className="w-5 h-5 group-hover:-translate-x-1 transition-transform" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 19l-7-7 7-7" />
            </svg>
            Back to Home
          </button>

          {/* Signup Card */}
          <div className="bg-white/10 backdrop-blur-xl border border-white/20 rounded-3xl shadow-2xl p-8 md:p-10">
            {/* Logo and Header */}
            <div className="text-center mb-8">
              <div className="w-16 h-16 bg-gradient-to-br from-blue-500 to-purple-600 rounded-2xl flex items-center justify-center text-white shadow-lg mx-auto mb-4">
                <PlaneIcon className="w-8 h-8" />
              </div>
              <h2 className="text-3xl font-bold text-white mb-2">
                {isLogin ? 'Welcome Back' : 'Start Your Journey'}
              </h2>
              <p className="text-white/70 text-sm">
                {isLogin ? 'Log in to continue planning' : 'Create your account to get started'}
              </p>
            </div>

            {/* Error Message */}
            {error && (
              <div className="bg-red-500/20 border border-red-500/50 text-red-200 px-4 py-3 rounded-xl text-sm">
                {error}
              </div>
            )}

            {/* Success Message */}
            {success && (
              <div className="bg-green-500/20 border border-green-500/50 text-green-200 px-4 py-3 rounded-xl text-sm">
                {success}
              </div>
            )}

            {/* Form */}
            <form onSubmit={handleSubmit} className="space-y-5">
              {/* Name Field (Signup only) */}
              {!isLogin && (
                <div>
                  <label className="block text-white/90 text-sm font-semibold mb-2">
                    Full Name
                  </label>
                  <input
                    type="text"
                    name="name"
                    value={formData.name}
                    onChange={handleInputChange}
                    placeholder="John Doe"
                    className="w-full bg-white/10 border border-white/30 rounded-xl px-4 py-3.5 text-white placeholder-white/50 focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent transition-all backdrop-blur-sm"
                    required
                  />
                </div>
              )}

              {/* Email Field */}
              <div>
                <label className="block text-white/90 text-sm font-semibold mb-2">
                  Email Address
                </label>
                <input
                  type="email"
                  name="email"
                  value={formData.email}
                  onChange={handleInputChange}
                  placeholder="you@example.com"
                  className="w-full bg-white/10 border border-white/30 rounded-xl px-4 py-3.5 text-white placeholder-white/50 focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent transition-all backdrop-blur-sm"
                  required
                />
              </div>

              {/* Password Field */}
              <div>
                <label className="block text-white/90 text-sm font-semibold mb-2">
                  Password
                </label>
                <input
                  type="password"
                  name="password"
                  value={formData.password}
                  onChange={handleInputChange}
                  onFocus={() => setPasswordFocused(true)}
                  onBlur={() => setPasswordFocused(false)}
                  placeholder="••••••••"
                  className="w-full bg-white/10 border border-white/30 rounded-xl px-4 py-3.5 text-white placeholder-white/50 focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent transition-all backdrop-blur-sm"
                  required
                />

                {/* Password Requirements (Signup only) */}
                {!isLogin && (passwordFocused || formData.password) && (
                  <div className="mt-3 p-3 bg-white/5 rounded-lg border border-white/10 space-y-2">
                    <p className="text-white/70 text-xs font-semibold mb-2">Password must contain:</p>
                    <PasswordRequirement
                      met={passwordValidations.minLength}
                      text="At least 8 characters"
                    />
                    <PasswordRequirement
                      met={passwordValidations.hasUpperCase}
                      text="One uppercase letter (A-Z)"
                    />
                    <PasswordRequirement
                      met={passwordValidations.hasLowerCase}
                      text="One lowercase letter (a-z)"
                    />
                    <PasswordRequirement
                      met={passwordValidations.hasNumber}
                      text="One number (0-9)"
                    />
                    <PasswordRequirement
                      met={passwordValidations.hasSpecialChar}
                      text="One special character (!@#$%^&*)"
                    />
                  </div>
                )}
              </div>

              {/* Confirm Password (Signup only) */}
              {!isLogin && (
                <div>
                  <label className="block text-white/90 text-sm font-semibold mb-2">
                    Confirm Password
                  </label>
                  <input
                    type="password"
                    name="confirmPassword"
                    value={formData.confirmPassword}
                    onChange={handleInputChange}
                    placeholder="••••••••"
                    className="w-full bg-white/10 border border-white/30 rounded-xl px-4 py-3.5 text-white placeholder-white/50 focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent transition-all backdrop-blur-sm"
                    required
                  />
                </div>
              )}

              {/* Remember Me / Forgot Password (Login only) */}
              {isLogin && (
                <div className="flex items-center justify-between text-sm">
                  <label className="flex items-center gap-2 text-white/80 cursor-pointer">
                    <input type="checkbox" className="w-4 h-4 rounded border-white/30 bg-white/10" />
                    Remember me
                  </label>
                  <a href="#" className="text-blue-400 hover:text-blue-300 transition-colors">
                    Forgot password?
                  </a>
                </div>
              )}

              {/* Submit Button */}
              <button
                type="submit"
                disabled={loading}
                className="w-full bg-gradient-to-r from-blue-600 to-purple-600 text-white py-4 rounded-xl font-bold text-lg hover:shadow-2xl hover:scale-[1.02] transition-all duration-300 shadow-xl disabled:opacity-50 disabled:cursor-not-allowed disabled:hover:scale-100"
              >
                {loading ? (
                  <span className="flex items-center justify-center gap-2">
                    <svg className="animate-spin h-5 w-5" viewBox="0 0 24 24">
                      <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" fill="none"></circle>
                      <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"></path>
                    </svg>
                    {isLogin ? 'Logging in...' : 'Creating account...'}
                  </span>
                ) : (
                  isLogin ? 'Log In' : 'Create Account'
                )}
              </button>

              {/* Divider */}
              <div className="relative my-6">
                <div className="absolute inset-0 flex items-center">
                  <div className="w-full border-t border-white/20"></div>
                </div>
                <div className="relative flex justify-center text-sm">
                  <span className="px-4 bg-transparent text-white/60">or continue with</span>
                </div>
              </div>

              {/* Social Login Buttons */}
              <div className="grid grid-cols-2 gap-3">
                <button
                  type="button"
                  className="flex items-center justify-center gap-2 bg-white/10 border border-white/30 text-white py-3 rounded-xl hover:bg-white/20 transition-all backdrop-blur-sm"
                >
                  <svg className="w-5 h-5" viewBox="0 0 24 24" fill="currentColor">
                    <path d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92c-.26 1.37-1.04 2.53-2.21 3.31v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.09z" fill="#4285F4"/>
                    <path d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z" fill="#34A853"/>
                    <path d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.07H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.93l2.85-2.22.81-.62z" fill="#FBBC05"/>
                    <path d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.07l3.66 2.84c.87-2.6 3.3-4.53 6.16-4.53z" fill="#EA4335"/>
                  </svg>
                  Google
                </button>
                <button
                  type="button"
                  className="flex items-center justify-center gap-2 bg-white/10 border border-white/30 text-white py-3 rounded-xl hover:bg-white/20 transition-all backdrop-blur-sm"
                >
                  <svg className="w-5 h-5" fill="currentColor" viewBox="0 0 24 24">
                    <path d="M12 2C6.477 2 2 6.477 2 12c0 4.42 2.865 8.17 6.839 9.49.5.092.682-.217.682-.482 0-.237-.008-.866-.013-1.7-2.782.603-3.369-1.34-3.369-1.34-.454-1.156-1.11-1.463-1.11-1.463-.908-.62.069-.608.069-.608 1.003.07 1.531 1.03 1.531 1.03.892 1.529 2.341 1.087 2.91.831.092-.646.35-1.086.636-1.336-2.22-.253-4.555-1.11-4.555-4.943 0-1.091.39-1.984 1.029-2.683-.103-.253-.446-1.27.098-2.647 0 0 .84-.269 2.75 1.025A9.578 9.578 0 0112 6.836c.85.004 1.705.114 2.504.336 1.909-1.294 2.747-1.025 2.747-1.025.546 1.377.203 2.394.1 2.647.64.699 1.028 1.592 1.028 2.683 0 3.842-2.339 4.687-4.566 4.935.359.309.678.919.678 1.852 0 1.336-.012 2.415-.012 2.743 0 .267.18.578.688.48C19.138 20.167 22 16.418 22 12c0-5.523-4.477-10-10-10z"/>
                  </svg>
                  GitHub
                </button>
              </div>
            </form>

            {/* Toggle Login/Signup */}
            <div className="mt-8 text-center">
              <p className="text-white/70 text-sm">
                {isLogin ? "Don't have an account?" : "Already have an account?"}
                {' '}
                <button
                  onClick={() => setIsLogin(!isLogin)}
                  className="text-blue-400 hover:text-blue-300 font-semibold transition-colors underline underline-offset-2"
                >
                  {isLogin ? 'Sign up' : 'Log in'}
                </button>
              </p>
            </div>
          </div>

          {/* Terms */}
          <p className="text-center text-white/50 text-xs mt-6">
            By continuing, you agree to our{' '}
            <a href="#" className="text-white/70 hover:text-white underline">Terms of Service</a>
            {' '}and{' '}
            <a href="#" className="text-white/70 hover:text-white underline">Privacy Policy</a>
          </p>
        </div>
      </div>
    </div>
  );
}

// --- DASHBOARD COMPONENT ---
function Dashboard({ userName, currentUser, onBack, onLogout, onDeleteAccount }) {
  const [showDropdown, setShowDropdown] = useState(false);
  const [chatMessages, setChatMessages] = useState([
    { type: 'bot', text: 'Hi there! How can I help you plan your trip?' }
  ]);
  const [inputMessage, setInputMessage] = useState('');

  const flightOptions = [
    { airline: 'Global Airways', logo: '✈️', price: 540, available: true },
    { airline: 'Stroks', logo: '🛫', price: 540, available: true },
    { airline: 'Taxime', logo: '🛩️', price: 540, available: true },
    { airline: 'SkyLink Express', logo: '✈️', price: 540, duration: '12h19', available: true },
    { airline: 'Ansin Gph', logo: '🛫', price: 540, duration: '13h18', available: true },
    { airline: 'Prenime', logo: '✈️', price: 540, flight: 'V12010', available: true },
    { airline: 'Porrooh', logo: '🛬', price: 540, flight: 'V12019', available: true },
    { airline: 'Credh', logo: '🛩️', price: 540, flight: 'V12012', available: true }
  ];

  const handleSendMessage = () => {
    if (inputMessage.trim()) {
      setChatMessages([...chatMessages, { type: 'user', text: inputMessage }]);
      setInputMessage('');

      // Simulate bot response
      setTimeout(() => {
        setChatMessages(prev => [...prev, {
          type: 'bot',
          text: 'I can help you find flights, hotels, and activities for your trip!'
        }]);
      }, 1000);
    }
  };

  return (
    <div className="min-h-screen bg-gradient-to-br from-slate-50 via-blue-50 to-purple-50">
      {/* Navigation Bar */}
      <nav className="bg-white/80 backdrop-blur-xl border-b border-gray-200/50 sticky top-0 z-50 shadow-sm">
        <div className="max-w-7xl mx-auto px-6 h-20 flex items-center justify-between">
          <div className="flex items-center gap-3">
            <div className="w-12 h-12 bg-gradient-to-br from-blue-500 to-purple-600 rounded-2xl flex items-center justify-center text-white shadow-lg">
              <PlaneIcon className="w-6 h-6" />
            </div>
            <span className="font-bold text-2xl tracking-tight bg-gradient-to-r from-blue-600 to-purple-600 bg-clip-text text-transparent">NexTrip AI</span>
          </div>

          <div className="flex items-center gap-4">
            <button onClick={onBack} className="text-gray-600 hover:text-gray-900 transition-colors flex items-center gap-2 px-4 py-2 rounded-xl hover:bg-gray-100">
              <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M10 19l-7-7m0 0l7-7m-7 7h18" />
              </svg>
              <span className="font-semibold">Home</span>
            </button>

            {/* User Dropdown */}
            <div className="relative">
              <button
                onClick={() => setShowDropdown(!showDropdown)}
                className="flex items-center gap-2 hover:bg-gray-50 px-3 py-2 rounded-lg transition-colors"
              >
                <div className="w-8 h-8 bg-gradient-to-br from-blue-500 to-purple-600 rounded-full flex items-center justify-center text-white font-bold text-sm">
                  {userName.charAt(0).toUpperCase()}
                </div>
                <svg
                  className={`w-4 h-4 text-gray-600 transition-transform ${showDropdown ? 'rotate-180' : ''}`}
                  fill="none"
                  stroke="currentColor"
                  viewBox="0 0 24 24"
                >
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
                </svg>
              </button>

              {showDropdown && (
                <div className="absolute right-0 mt-2 w-64 bg-white rounded-2xl shadow-2xl border border-gray-100 overflow-hidden">
                  <div className="px-5 py-4 bg-gradient-to-br from-blue-50 to-purple-50">
                    <div className="flex items-center gap-3">
                      <div className="w-12 h-12 bg-gradient-to-br from-blue-500 to-purple-600 rounded-full flex items-center justify-center text-white font-bold text-lg shadow-md">
                        {userName.charAt(0).toUpperCase()}
                      </div>
                      <div className="flex-1 min-w-0">
                        <p className="text-sm font-bold text-gray-900 truncate">{userName}</p>
                        <p className="text-xs text-gray-600 truncate">{currentUser.email}</p>
                      </div>
                    </div>
                  </div>
                  <div className="py-2">
                    <button
                      onClick={() => {
                        setShowDropdown(false);
                        onLogout();
                      }}
                      className="w-full text-left px-5 py-3 text-sm text-gray-700 hover:bg-gray-50 transition-all flex items-center gap-3 group"
                    >
                      <div className="w-8 h-8 bg-gray-100 rounded-lg flex items-center justify-center group-hover:bg-gray-200 transition-colors">
                        <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M17 16l4-4m0 0l-4-4m4 4H7m6 4v1a3 3 0 01-3 3H6a3 3 0 01-3-3V7a3 3 0 013-3h4a3 3 0 013 3v1" />
                        </svg>
                      </div>
                      <span className="font-semibold">Logout</span>
                    </button>
                    <button
                      onClick={() => {
                        setShowDropdown(false);
                        onDeleteAccount();
                      }}
                      className="w-full text-left px-5 py-3 text-sm text-red-600 hover:bg-red-50 transition-all flex items-center gap-3 group"
                    >
                      <div className="w-8 h-8 bg-red-100 rounded-lg flex items-center justify-center group-hover:bg-red-200 transition-colors">
                        <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" />
                        </svg>
                      </div>
                      <span className="font-semibold">Delete Account</span>
                    </button>
                  </div>
                </div>
              )}
            </div>
          </div>
        </div>
      </nav>

      {/* Main Content */}
      <div className="max-w-7xl mx-auto p-8">
        {/* Welcome Banner */}
        <div className="mb-8 bg-gradient-to-r from-blue-600 to-purple-600 rounded-3xl p-8 shadow-2xl">
          <div className="flex items-center justify-between">
            <div>
              <h1 className="text-4xl font-bold text-white mb-2">Welcome back, {userName.split(' ')[0]}! ✈️</h1>
              <p className="text-blue-100 text-lg">Let's plan your next adventure together</p>
            </div>
            <div className="hidden md:block">
              <div className="w-24 h-24 bg-white/20 backdrop-blur-sm rounded-full flex items-center justify-center">
                <svg className="w-12 h-12 text-white" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M3.055 11H5a2 2 0 012 2v1a2 2 0 002 2 2 2 0 012 2v2.945M8 3.935V5.5A2.5 2.5 0 0010.5 8h.5a2 2 0 012 2 2 2 0 104 0 2 2 0 012-2h1.064M15 20.488V18a2 2 0 012-2h3.064M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
                </svg>
              </div>
            </div>
          </div>
        </div>

        <div className="grid grid-cols-1 lg:grid-cols-3 gap-8">
          {/* Flight Dashboard - Left 2/3 */}
          <div className="lg:col-span-2">
            <div className="bg-white/80 backdrop-blur-sm rounded-3xl shadow-xl p-8 border border-gray-100">
              <div className="flex items-center justify-between mb-6">
                <div>
                  <h2 className="text-3xl font-bold bg-gradient-to-r from-blue-600 to-purple-600 bg-clip-text text-transparent mb-1">Flight Options</h2>
                  <p className="text-gray-600">Best deals for your next trip</p>
                </div>
                <div className="flex items-center gap-2 bg-gradient-to-r from-blue-50 to-purple-50 px-4 py-2 rounded-full">
                  <svg className="w-5 h-5 text-blue-600" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13 7h8m0 0v8m0-8l-8 8-4-4-6 6" />
                  </svg>
                  <span className="text-sm font-semibold text-blue-600">8 options</span>
                </div>
              </div>

              {/* Flight Grid */}
              <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-4">
                {flightOptions.map((flight, index) => (
                  <div
                    key={index}
                    className="group bg-gradient-to-br from-white to-gray-50 border-2 border-gray-100 rounded-2xl p-5 hover:border-blue-300 hover:shadow-2xl transition-all duration-300 hover:-translate-y-2 cursor-pointer"
                  >
                    <div className="flex items-start justify-between mb-4">
                      <div className="flex items-center gap-3">
                        <div className="w-12 h-12 bg-gradient-to-br from-blue-100 to-purple-100 rounded-xl flex items-center justify-center text-2xl shadow-sm">
                          {flight.logo}
                        </div>
                        <div>
                          <p className="font-bold text-gray-900 text-sm">{flight.airline}</p>
                          {flight.duration && (
                            <div className="flex items-center gap-1 mt-1">
                              <svg className="w-3 h-3 text-gray-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 8v4l3 3m6-3a9 9 0 11-18 0 9 9 0 0118 0z" />
                              </svg>
                              <p className="text-xs text-gray-500">{flight.duration}</p>
                            </div>
                          )}
                          {flight.flight && <p className="text-xs text-blue-600 font-semibold mt-1">{flight.flight}</p>}
                        </div>
                      </div>
                    </div>
                    <div className="flex items-center justify-between mt-4 pt-4 border-t border-gray-200">
                      <div>
                        <p className="text-2xl font-bold bg-gradient-to-r from-blue-600 to-purple-600 bg-clip-text text-transparent">
                          ${flight.price}
                        </p>
                        <p className="text-xs text-gray-500">per person</p>
                      </div>
                      <button className="bg-gradient-to-r from-blue-500 to-purple-500 text-white px-4 py-2 rounded-xl text-sm font-semibold opacity-0 group-hover:opacity-100 transition-opacity hover:shadow-lg">
                        Select
                      </button>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          </div>

          {/* AI Chat - Right 1/3 */}
          <div className="bg-white/80 backdrop-blur-sm rounded-3xl shadow-xl flex flex-col h-[calc(100vh-17rem)] border border-gray-100">
            {/* Chat Header */}
            <div className="p-6 bg-gradient-to-r from-blue-500 to-purple-500 rounded-t-3xl">
              <div className="flex items-center gap-3">
                <div className="w-12 h-12 bg-white/20 backdrop-blur-sm rounded-full flex items-center justify-center shadow-lg">
                  <svg className="w-6 h-6 text-white" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9.663 17h4.673M12 3v1m6.364 1.636l-.707.707M21 12h-1M4 12H3m3.343-5.657l-.707-.707m2.828 9.9a5 5 0 117.072 0l-.548.547A3.374 3.374 0 0014 18.469V19a2 2 0 11-4 0v-.531c0-.895-.356-1.754-.988-2.386l-.548-.547z" />
                  </svg>
                </div>
                <div>
                  <h2 className="text-lg font-bold text-white">AI Assistant</h2>
                  <div className="flex items-center gap-1">
                    <div className="w-2 h-2 bg-green-400 rounded-full animate-pulse"></div>
                    <p className="text-xs text-blue-100">Online</p>
                  </div>
                </div>
              </div>
            </div>

            {/* Chat Messages */}
            <div className="flex-1 overflow-y-auto p-6 space-y-4 bg-gradient-to-b from-gray-50/50 to-white/50">
              {chatMessages.map((message, index) => (
                <div key={index} className={`flex ${message.type === 'user' ? 'justify-end' : 'justify-start'} animate-fade-in`}>
                  {message.type === 'bot' && (
                    <div className="w-8 h-8 bg-gradient-to-br from-blue-100 to-purple-100 rounded-full flex items-center justify-center mr-2 flex-shrink-0">
                      <svg className="w-4 h-4 text-blue-600" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9.663 17h4.673M12 3v1m6.364 1.636l-.707.707M21 12h-1M4 12H3m3.343-5.657l-.707-.707m2.828 9.9a5 5 0 117.072 0l-.548.547A3.374 3.374 0 0014 18.469V19a2 2 0 11-4 0v-.531c0-.895-.356-1.754-.988-2.386l-.548-.547z" />
                      </svg>
                    </div>
                  )}
                  <div className={`max-w-[75%] px-4 py-3 rounded-2xl shadow-sm ${
                    message.type === 'user'
                      ? 'bg-gradient-to-r from-blue-500 to-purple-500 text-white rounded-br-sm'
                      : 'bg-white text-gray-900 border border-gray-200 rounded-bl-sm'
                  }`}>
                    <p className="text-sm leading-relaxed">{message.text}</p>
                  </div>
                </div>
              ))}
            </div>

            {/* Chat Input */}
            <div className="p-5 bg-white border-t border-gray-200 rounded-b-3xl">
              <div className="flex gap-3">
                <input
                  type="text"
                  value={inputMessage}
                  onChange={(e) => setInputMessage(e.target.value)}
                  onKeyDown={(e) => e.key === 'Enter' && handleSendMessage()}
                  placeholder="Ask me anything about your trip..."
                  className="flex-1 px-5 py-3.5 bg-gray-50 border-2 border-gray-200 rounded-2xl focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent transition-all text-sm"
                />
                <button
                  onClick={handleSendMessage}
                  className="bg-gradient-to-r from-blue-500 to-purple-500 text-white p-3.5 rounded-2xl font-semibold hover:shadow-xl transition-all duration-300 hover:scale-105 flex items-center justify-center"
                >
                  <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 19l9 2-9-18-9 18 9-2zm0 0v-8" />
                  </svg>
                </button>
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

// --- LANDING PAGE COMPONENT ---
function LandingPage({ onGetStarted, onStartPlanning, currentUser, userName, onLogout, onDeleteAccount }) {
  const [userCount, setUserCount] = useState(0);
  const [loading, setLoading] = useState(true);
  const [showDropdown, setShowDropdown] = useState(false);

  useEffect(() => {
    const fetchUserCount = async () => {
      try {
        // Count distinct users from the 'users' collection in Firestore
        const usersCollection = collection(db, 'users');
        const snapshot = await getCountFromServer(usersCollection);
        const count = snapshot.data().count;

        // Format the user count (e.g., 1234 -> "1.2K+", 50000 -> "50K+")
        let formattedCount;
        if (count >= 1000000) {
          formattedCount = `${(count / 1000000).toFixed(1)}M+`;
        } else if (count >= 1000) {
          formattedCount = `${(count / 1000).toFixed(1)}K+`;
        } else {
          formattedCount = `${count}+`;
        }

        setUserCount(formattedCount);
      } catch (error) {
        console.error('Error fetching user count:', error);
        // Keep default value on error
        setUserCount('50K+');
      } finally {
        setLoading(false);
      }
    };

    fetchUserCount();
  }, []);

  return (
    <div className="min-h-screen bg-slate-900 font-sans text-slate-900">

      {/* --- Full Screen Background Image --- */}
      <div className="fixed inset-0 z-0">
        <img
          src="https://images.unsplash.com/photo-1506905925346-21bda4d32df4?auto=format&fit=crop&q=80&w=2070"
          className="w-full h-full object-cover"
          alt="Himalayas"
        />
        {/* Gradient Overlay for better text readability */}
        <div className="absolute inset-0 bg-gradient-to-b from-slate-900/60 via-slate-900/40 to-slate-900/80"></div>
      </div>

      {/* --- Navigation Bar --- */}
      <nav className="relative z-50 bg-transparent backdrop-blur-md border-b border-white/10">
        <div className="max-w-7xl mx-auto px-8 h-20 flex items-center justify-between">
          <div className="flex items-center gap-3">
             {/* Simple Logo Icon */}
             <div className="w-10 h-10 bg-gradient-to-br from-blue-500 to-purple-600 rounded-xl flex items-center justify-center text-white shadow-lg">
                <PlaneIcon className="w-5 h-5" />
             </div>
             <span className="font-bold text-2xl tracking-tight text-white">NexTrip AI</span>
          </div>

          {/* Nav Links */}
          <div className="hidden md:flex items-center gap-10 text-sm font-semibold text-white/80">
            <a href="#" className="hover:text-white transition decoration-2 underline-offset-8 hover:underline">Home</a>
            <a href="#features" className="hover:text-white transition">Features</a>
          </div>

          {/* User Greeting & Dropdown or Get Started Button */}
          {currentUser ? (
            <div className="relative">
              <button
                onClick={() => setShowDropdown(!showDropdown)}
                className="flex items-center gap-3 bg-white/10 backdrop-blur-sm border border-white/20 px-5 py-2.5 rounded-full hover:bg-white/20 transition-all"
              >
                <div className="w-8 h-8 bg-gradient-to-br from-blue-500 to-purple-600 rounded-full flex items-center justify-center text-white font-bold text-sm">
                  {userName.charAt(0).toUpperCase()}
                </div>
                <span className="text-white font-semibold">
                  Hello, {userName.split(' ')[0]}
                </span>
                <svg
                  className={`w-4 h-4 text-white transition-transform ${showDropdown ? 'rotate-180' : ''}`}
                  fill="none"
                  stroke="currentColor"
                  viewBox="0 0 24 24"
                >
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
                </svg>
              </button>

              {/* Dropdown Menu */}
              {showDropdown && (
                <div className="absolute right-0 mt-3 w-64 bg-white rounded-2xl shadow-2xl border border-gray-100 overflow-hidden animate-fade-in">
                  {/* User Info Section */}
                  <div className="px-5 py-4 bg-gradient-to-br from-blue-50 to-purple-50">
                    <div className="flex items-center gap-3 mb-2">
                      <div className="w-12 h-12 bg-gradient-to-br from-blue-500 to-purple-600 rounded-full flex items-center justify-center text-white font-bold text-lg shadow-md">
                        {userName.charAt(0).toUpperCase()}
                      </div>
                      <div className="flex-1 min-w-0">
                        <p className="text-sm font-bold text-gray-900 truncate">{userName}</p>
                        <p className="text-xs text-gray-600 truncate">{currentUser.email}</p>
                      </div>
                    </div>
                  </div>

                  {/* Menu Items */}
                  <div className="py-2">
                    <button
                      onClick={() => {
                        setShowDropdown(false);
                        onLogout();
                      }}
                      className="w-full text-left px-5 py-3 text-sm text-gray-700 hover:bg-gray-50 transition-all flex items-center gap-3 group"
                    >
                      <div className="w-8 h-8 bg-gray-100 rounded-lg flex items-center justify-center group-hover:bg-gray-200 transition-colors">
                        <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M17 16l4-4m0 0l-4-4m4 4H7m6 4v1a3 3 0 01-3 3H6a3 3 0 01-3-3V7a3 3 0 013-3h4a3 3 0 013 3v1" />
                        </svg>
                      </div>
                      <span className="font-semibold">Logout</span>
                    </button>
                    <button
                      onClick={() => {
                        setShowDropdown(false);
                        onDeleteAccount();
                      }}
                      className="w-full text-left px-5 py-3 text-sm text-red-600 hover:bg-red-50 transition-all flex items-center gap-3 group"
                    >
                      <div className="w-8 h-8 bg-red-100 rounded-lg flex items-center justify-center group-hover:bg-red-200 transition-colors">
                        <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" />
                        </svg>
                      </div>
                      <span className="font-semibold">Delete Account</span>
                    </button>
                  </div>
                </div>
              )}
            </div>
          ) : (
            <button onClick={onGetStarted} className="bg-gradient-to-r from-blue-600 to-purple-600 text-white px-8 py-3 rounded-full text-sm font-bold hover:shadow-2xl hover:scale-105 transition-all duration-300 shadow-lg">
              Get Started
            </button>
          )}
        </div>
      </nav>

      {/* --- Hero Section --- */}
      <header className="relative min-h-screen flex flex-col items-center justify-center px-4 -mt-20">
        <div className="relative z-10 text-center max-w-5xl mx-auto space-y-8">
          {/* Main Headline */}
          <div className="space-y-6 animate-fade-in">
            <h1 className="text-6xl md:text-8xl font-bold text-white leading-tight drop-shadow-2xl">
              Your Journey,<br/>
              <span className="bg-gradient-to-r from-blue-400 to-purple-400 bg-clip-text text-transparent">
                Intelligent Design
              </span>
            </h1>
            <p className="text-xl md:text-2xl text-white/90 max-w-3xl mx-auto leading-relaxed font-light">
              Plan extraordinary trips with AI-powered insights. From flights to hotels,
              we craft personalized itineraries that match your unique style.
            </p>
          </div>

          {/* CTA Buttons */}
          <div className="flex flex-col sm:flex-row items-center justify-center gap-4 pt-8">
            <button onClick={onStartPlanning} className="group bg-white text-slate-900 px-10 py-4 rounded-full text-lg font-bold hover:shadow-2xl hover:scale-105 transition-all duration-300 shadow-xl flex items-center gap-3">
              Start Planning
              <svg className="w-5 h-5 group-hover:translate-x-1 transition-transform" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M17 8l4 4m0 0l-4 4m4-4H3" />
              </svg>
            </button>
          </div>

          {/* Stats */}
          <div className="grid grid-cols-2 gap-12 pt-16 max-w-2xl mx-auto">
            <div className="text-center">
              <div className="text-4xl md:text-5xl font-bold text-white">190+</div>
              <div className="text-white/70 text-sm mt-2">Countries</div>
            </div>
            <div className="text-center">
              <div className="text-4xl md:text-5xl font-bold text-white">
                {loading ? '...' : userCount}
              </div>
              <div className="text-white/70 text-sm mt-2">Users</div>
            </div>
          </div>
        </div>

        {/* Scroll Indicator */}
        <div className="absolute bottom-10 left-1/2 -translate-x-1/2 animate-bounce">
          <svg className="w-6 h-6 text-white/60" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 14l-7 7m0 0l-7-7m7 7V3" />
          </svg>
        </div>
      </header>

      {/* --- Feature Cards Section --- */}
      <section id="features" className="relative z-10 bg-gradient-to-b from-slate-900/0 via-slate-900/90 to-slate-900 py-24 px-4">
        <div className="max-w-6xl mx-auto">
          <div className="text-center mb-16">
            <h2 className="text-4xl md:text-5xl font-bold text-white mb-4">Powered by Intelligence</h2>
            <p className="text-xl text-white/70 max-w-2xl mx-auto">Experience travel planning reimagined with cutting-edge AI technology</p>
          </div>

          <div className="grid md:grid-cols-3 gap-8">
            {/* Card 1 */}
            <FeatureCard
              icon={<div className="p-4 rounded-full bg-gradient-to-br from-blue-500 to-blue-600 text-white shadow-xl"><PlaneIcon className="w-6 h-6" /></div>}
              title="Smart Planning"
              desc="Our AI analyzes thousands of flight routes to find the perfect schedule for your specific needs."
            />

            {/* Card 2 */}
            <FeatureCard
              icon={<div className="p-4 rounded-full bg-gradient-to-br from-purple-500 to-purple-600 text-white shadow-xl"><MapIcon className="w-6 h-6" /></div>}
              title="Global Access"
              desc="Access real-time data from hotels and airlines across 190+ countries instantly."
            />

            {/* Card 3 */}
            <FeatureCard
              icon={<div className="p-4 rounded-full bg-gradient-to-br from-indigo-500 to-indigo-600 text-white shadow-xl"><ChipIcon className="w-6 h-6" /></div>}
              title="Intelligent Tech"
              desc="Powered by advanced neural networks that learn your preferences with every trip you plan."
            />
          </div>
        </div>
      </section>
    </div>
  );
}

// --- HELPER COMPONENT ---
function FeatureCard({ icon, title, desc }) {
  return (
    <div className="bg-white/10 backdrop-blur-md border border-white/20 p-10 rounded-3xl shadow-2xl flex flex-col items-center text-center hover:-translate-y-2 hover:bg-white/15 transition-all duration-300">
      <div className="mb-6">
        {icon}
      </div>
      <h3 className="text-2xl font-bold text-white mb-4">{title}</h3>
      <p className="text-white/70 leading-relaxed">
        {desc}
      </p>
    </div>
  );
}

// --- PASSWORD REQUIREMENT COMPONENT ---
function PasswordRequirement({ met, text }) {
  return (
    <div className="flex items-center gap-2 text-xs">
      {met ? (
        <svg className="w-4 h-4 text-green-400 flex-shrink-0" fill="currentColor" viewBox="0 0 20 20">
          <path fillRule="evenodd" d="M10 18a8 8 0 100-16 8 8 0 000 16zm3.707-9.293a1 1 0 00-1.414-1.414L9 10.586 7.707 9.293a1 1 0 00-1.414 1.414l2 2a1 1 0 001.414 0l4-4z" clipRule="evenodd" />
        </svg>
      ) : (
        <svg className="w-4 h-4 text-white/30 flex-shrink-0" fill="currentColor" viewBox="0 0 20 20">
          <path fillRule="evenodd" d="M10 18a8 8 0 100-16 8 8 0 000 16zM8.707 7.293a1 1 0 00-1.414 1.414L8.586 10l-1.293 1.293a1 1 0 101.414 1.414L10 11.414l1.293 1.293a1 1 0 001.414-1.414L11.414 10l1.293-1.293a1 1 0 00-1.414-1.414L10 8.586 8.707 7.293z" clipRule="evenodd" />
        </svg>
      )}
      <span className={met ? 'text-green-400' : 'text-white/50'}>{text}</span>
    </div>
  );
}

// --- ICONS (Simple SVGs) ---
const PlaneIcon = (props) => <svg {...props} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M2 12h20"/><path d="M13 2l3.5 10h-7L13 2z"/><path d="M13 22l3.5-10h-7L13 22z"/></svg>
const MapIcon = (props) => <svg {...props} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M3 6l6-3 6 3 6-3v14l-6 3-6-3-6 3V6z"/><path d="M9 3v14"/><path d="M15 6v14"/></svg>
const ChipIcon = (props) => <svg {...props} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><rect x="4" y="4" width="16" height="16" rx="2"/><rect x="9" y="9" width="6" height="6"/><path d="M9 1v3"/><path d="M15 1v3"/><path d="M9 20v3"/><path d="M15 20v3"/><path d="M20 9h3"/><path d="M20 14h3"/><path d="M1 9h3"/><path d="M1 14h3"/></svg>
