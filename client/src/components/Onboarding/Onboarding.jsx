import React, { useState, useEffect } from "react";
import "./Onboarding.css";
import qaImage from "../../assets/onboarding/Q&A.png";
import filtersImage from "../../assets/onboarding/Filters.png";
import loginImage from "../../assets/onboarding/Login.png";
import publishImage from "../../assets/onboarding/Publish.png";
import nudgesImage from "../../assets/onboarding/Nudge.png";
import welcomeImage from "../../assets/onboarding/Q&A.png"; // same image

export const Onboarding = ({ isOpen, onClose, onLogin, isSignedIn = false }) => {
  const [currentScreen, setCurrentScreen] = useState(1);
  // 7 screens when not signed in (last one is login), 6 when signed in
  const totalScreens = isSignedIn ? 6 : 7;

  // Reset to first screen when modal opens
  useEffect(() => {
    if (isOpen) {
      setCurrentScreen(1);
    }
  }, [isOpen]);

  // Handle ESC key - only allow closing if signed in
  useEffect(() => {
    if (!isOpen || !isSignedIn) return;
    const handleEsc = (e) => {
      if (e.key === "Escape") {
        onClose();
      }
    };
    window.addEventListener("keydown", handleEsc);
    return () => window.removeEventListener("keydown", handleEsc);
  }, [isOpen, onClose, isSignedIn]);

  if (!isOpen) return null;

  const handleNext = () => {
    if (currentScreen < totalScreens) {
      setCurrentScreen(currentScreen + 1);
    }
  };

  const handleBack = () => {
    if (currentScreen > 1) {
      setCurrentScreen(currentScreen - 1);
    }
  };

  const handleSkip = () => {
    if (isSignedIn) {
      // If signed in, close the modal
      onClose();
    } else {
      // If not signed in, go to login screen (screen 7)
      setCurrentScreen(7);
    }
  };

  const handleLoginClick = () => {
    if (onLogin) {
      onLogin();
    }
  };

  const handleReturnClick = () => {
    onClose();
  };

  const renderScreen = () => {
    switch (currentScreen) {
      case 1:
        return (
          <div className="onboarding-screen">
            <h2 className="onboarding-title">Welcome to ListServ Calendar</h2>
            <p className="onboarding-body">
              Filter campus events and publish them to your own ListServ calendar.
            </p>
            <div className="onboarding-disclaimer-box">
              <h3 className="onboarding-disclaimer-title">Testing Mode Notice</h3>
              <ul className="onboarding-disclaimer-list">
                <li>This is an early test version.</li>
                <li>Your filter preferences may be visible to our team for research purposes.</li>
                <li>By signing up, you're helping us improve the experience.</li>
                <li>Best viewed on desktop.</li>
              </ul>
            </div>
          </div>
        );

      case 2:
        return (
          <div className="onboarding-screen">
            <h2 className="onboarding-title">Step 1: Log in with your school email</h2>
            <p className="onboarding-body">
              Sign in with your school Google account. We'll create a new ListServ Calendar in Google Calendar.
            </p>
            <ul className="onboarding-bullet-list">
              <li>It will NOT modify your personal calendar.</li>
              <li>It is a separate calendar you can toggle on or off anytime.</li>
              <li>You can delete it whenever you want.</li>
            </ul>
          </div>
        );

      case 3:
        return (
          <div className="onboarding-screen">
            <h2 className="onboarding-title">Step 2: Choose what you're interested in</h2>
            <p className="onboarding-body">
              Use filters to see events that match your interests.
            </p>
            <ul className="onboarding-bullet-list">
              <li>Filter by Event Type (Free food, Workshops, Mixers, etc.)</li>
              <li>Filter by Organizations</li>
            </ul>
            <p className="onboarding-footer-note">
              You can change filters anytime.
            </p>
          </div>
        );

      case 4:
        return (
          <div className="onboarding-screen">
            <h2 className="onboarding-title">Step 3: Publish your filtered events</h2>
            <p className="onboarding-body">
              Click "Publish to Google Calendar" when you're ready.
            </p>
            <ul className="onboarding-bullet-list">
              <li>Adds the currently filtered events to your ListServ Calendar</li>
              <li>Saves your filter preferences</li>
              <li>Keeps it separate from your personal events</li>
            </ul>
            <p className="onboarding-footer-note">
              If you change filters later, you can republish to update your calendar and preferences.
            </p>
          </div>
        );

      case 5:
        return (
          <div className="onboarding-screen">
            <h2 className="onboarding-title">Step 4: Nudge a friend</h2>
            <p className="onboarding-body">
              See something interesting? Share it.
            </p>
            <ul className="onboarding-bullet-list">
              <li>Nudge a friend to check it out</li>
              <li>Accept nudges from friends</li>
              <li>Discover events through people you trust</li>
            </ul>
          </div>
        );

      case 6:
        return (
          <div className="onboarding-screen">
            <h2 className="onboarding-title">Questions?</h2>
            <div className="onboarding-faq-accordion">
              <details className="onboarding-faq-item">
                <summary className="onboarding-faq-question">
                  Will this affect my personal calendar?
                </summary>
                <div className="onboarding-faq-answer-wrapper">
                  <div>
                    <p className="onboarding-faq-answer">
                      No. We create a separate 'ListServ Calendar' that you can toggle on/off or delete anytime.
                    </p>
                  </div>
                </div>
              </details>
              <details className="onboarding-faq-item">
                <summary className="onboarding-faq-question">
                  Can I delete the ListServ calendar later?
                </summary>
                <div className="onboarding-faq-answer-wrapper">
                  <div>
                    <p className="onboarding-faq-answer">
                      Yes. It's a normal Google Calendar you control.
                    </p>
                  </div>
                </div>
              </details>
              <details className="onboarding-faq-item">
                <summary className="onboarding-faq-question">
                  Why is this in testing mode?
                </summary>
                <div className="onboarding-faq-answer-wrapper">
                  <div>
                    <p className="onboarding-faq-answer">
                      We're piloting the product. Your filter preferences may be visible to our team for research so we can improve the experience.
                    </p>
                  </div>
                </div>
              </details>
              <details className="onboarding-faq-item">
                <summary className="onboarding-faq-question">
                  Does this work on mobile?
                </summary>
                <div className="onboarding-faq-answer-wrapper">
                  <div>
                    <p className="onboarding-faq-answer">
                      It works best on desktop right now.
                    </p>
                  </div>
                </div>
              </details>
            </div>
            <p className="onboarding-footer-note-small">
              Testing mode · Desktop recommended · Separate calendar created
            </p>
          </div>
        );

      case 7:
        return (
          <div className="onboarding-screen onboarding-login-screen">
            <h2 className="onboarding-title">Ready to get started?</h2>
            <p className="onboarding-body">
              Sign in with your school Google account to create your personalized ListServ Calendar.
            </p>
            <ul className="onboarding-bullet-list">
              <li>We'll create a separate calendar just for ListServ events</li>
              <li>Your personal calendar stays untouched</li>
              <li>You can delete it anytime</li>
            </ul>
          </div>
        );

      default:
        return null;
    }
  };

  return (
    <div className="onboarding-overlay" onClick={isSignedIn ? onClose : undefined}>
      <div className="onboarding-modal" onClick={(e) => e.stopPropagation()}>
        <div className="onboarding-layout">
          {/* Left panel - visual placeholder */}
          <div className="onboarding-left-panel">
            <div className="onboarding-visual-placeholder">
                {currentScreen === 1 && <img src={welcomeImage} alt="Welcome" className="onboarding-visual-image" />}
                {currentScreen === 2 && <img src={loginImage} alt="Login" className="onboarding-visual-image" />}
                {currentScreen === 3 && <img src={filtersImage} alt="Filters" className="onboarding-visual-image" />}
                {currentScreen === 4 && <img src={publishImage} alt="Publish" className="onboarding-visual-image" />}
                {currentScreen === 5 && <img src={nudgesImage} alt="Nudges" className="onboarding-visual-image" />}
                {currentScreen === 6 && <img src={qaImage} alt="FAQ" className="onboarding-visual-image" />}
                {currentScreen === 7 && <img src={loginImage} alt="Login" className="onboarding-visual-image" />}
              {/* 
                ============================================
                HOW TO ADD IMAGES TO THE VISUAL PLACEHOLDER
                ============================================
                
                Option 1: Single image for all screens
                ----------------------------------------
                1. Create folder: client/src/assets/onboarding/
                2. Add your image file (e.g., onboarding-hero.png)
                3. At the top of this file, add:
                   import onboardingHero from '../../assets/onboarding/onboarding-hero.png';
                4. Replace this comment with:
                   <img src={onboardingHero} alt="Onboarding visual" className="onboarding-visual-image" />
                
                Option 2: Different image per screen
                -------------------------------------
                1. Create folder: client/src/assets/onboarding/
                2. Add image files (e.g., screen1.png, screen2.png, etc.)
                3. At the top of this file, add:
                   import screen1Img from '../../assets/onboarding/screen1.png';
                   import screen2Img from '../../assets/onboarding/screen2.png';
                   // ... etc for all 6 screens
                4. Replace this comment with:
                   {currentScreen === 1 && <img src={screen1Img} alt="Welcome" className="onboarding-visual-image" />}
                   {currentScreen === 2 && <img src={screen2Img} alt="Login" className="onboarding-visual-image" />}
                   {currentScreen === 3 && <img src={screen3Img} alt="Filters" className="onboarding-visual-image" />}
                   {currentScreen === 4 && <img src={screen4Img} alt="Publish" className="onboarding-visual-image" />}
                   {currentScreen === 5 && <img src={screen5Img} alt="Nudges" className="onboarding-visual-image" />}
                   {currentScreen === 6 && <img src={screen6Img} alt="FAQ" className="onboarding-visual-image" />}
                
                Supported formats: PNG, JPG, SVG, WebP
                Recommended size: ~600x800px or similar aspect ratio
              */}
            </div>
          </div>

          {/* Right panel - content */}
          <div className="onboarding-right-panel">
            {/* Top: Progress dots + Skip button */}
            <div className="onboarding-top-bar">
              <div className="onboarding-progress-dots">
                {Array.from({ length: totalScreens }, (_, i) => (
                  <div
                    key={i + 1}
                    className={`onboarding-dot ${
                      i + 1 === currentScreen ? "active" : ""
                    }`}
                  />
                ))}
              </div>
              {currentScreen !== 7 && (
                <button
                  className="onboarding-skip-button"
                  onClick={handleSkip}
                  type="button"
                >
                  Skip intro
                </button>
              )}
            </div>

            {/* Content */}
            <div className="onboarding-content">{renderScreen()}</div>

            {/* Bottom: Navigation */}
            <div className="onboarding-navigation">
              <button
                className="onboarding-back-button"
                onClick={handleBack}
                disabled={currentScreen === 1}
                type="button"
              >
                Back
              </button>
              {currentScreen === totalScreens ? (
                isSignedIn ? (
                  <button
                    className="onboarding-login-button"
                    onClick={handleReturnClick}
                    type="button"
                  >
                    Return to ListServCalendar →
                  </button>
                ) : (
                  <button
                    className="onboarding-login-button"
                    onClick={handleLoginClick}
                    type="button"
                  >
                    Log in with School Email →
                  </button>
                )
              ) : (
                <button
                  className="onboarding-next-button"
                  onClick={handleNext}
                  type="button"
                >
                  Next
                </button>
              )}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
};
