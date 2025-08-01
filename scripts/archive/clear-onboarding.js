// Simple script to clear the onboarding flag from localStorage
// Run this in the browser console when Scout is open
console.log("Clearing onboarding flag...");
localStorage.removeItem('scout-onboarding-complete');
console.log("Onboarding flag cleared! Restart the app to see onboarding.");