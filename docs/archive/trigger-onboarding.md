# How to Trigger Onboarding

The onboarding flow is now properly configured. To see it:

1. **In the browser console of the running app**, run:
   ```javascript
   localStorage.removeItem('scout-onboarding-complete')
   ```

2. **Refresh the app** (Cmd+R)

The onboarding flow should now appear!

## What was fixed:

1. **Event listener cleanup**: Fixed the cleanup of the model download progress listener to prevent the "undefined is not an object" errors
2. **Onboarding trigger**: Removed the model check condition - now it only checks the localStorage flag
3. **Proper unmount handling**: Added proper cleanup when the onboarding component unmounts

## Note about the errors:
The event listener errors you saw were happening because the listener wasn't being properly cleaned up when switching between onboarding steps or when the component unmounted.