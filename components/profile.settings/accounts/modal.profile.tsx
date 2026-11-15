"use client";

import React, { useState, useEffect } from "react";
import { useMediaQuery } from "@/hooks/use-media-query";
import ProfileModalMobile from "./mobile.profile";
import ProfileModalDesktop from "./desktop.profile";
import DesktopTerms from "./terms/desktop.terms";
import DesktopAbout from "./about/desktop.about";
// import DesktopPreference from "./preferences/desktop.pref";
import { Dialog, DialogContent, DialogTitle } from "@/components/ui/dialog";
import { VisuallyHidden } from "@radix-ui/react-visually-hidden";
import MobileEditProfile from "./edit.profile/mobile.edit";
import DesktopEditProfile from "./edit.profile/desktop.edit";
import type { ProfileSaveStatus } from "@/lib/auth/profile-update";

type AuthProvider = {
  name: string;
  linked: boolean;
};

type UserData = {
  firstName: string;
  lastName: string;
  username: string;
  contactNumber?: string;
  dateOfBirth?: string;
  email: string;
  authProviders?: AuthProvider[];
  provider?: string;
  profilePictureUrl?: string | null;
};

type ProfileModalProps = {
  userData: UserData;
  onClose: () => void;
  isOpen: boolean;
  onProfileUpdated?: () => void;
};

export default function ProfileModal({
  userData: initialUserData,
  onClose,
  isOpen,
  onProfileUpdated,
}: ProfileModalProps) {
  const isMobile = useMediaQuery("(max-width: 1023px)");
  const [isEditing, setIsEditing] = useState(false);
  const [showTerms, setShowTerms] = useState(false);
  const [showAbout, setShowAbout] = useState(false);
  // const [showPreferences, setShowPreferences] = useState(false);
  const [localUserData, setLocalUserData] = useState(initialUserData);
  const [profileNotice, setProfileNotice] = useState("");

  // Update local state when initialUserData changes
  useEffect(() => {
    setLocalUserData(initialUserData);
  }, [initialUserData]);

  // Reset states when modal is opened
  useEffect(() => {
    if (isOpen) {
      setIsEditing(false);
      setShowTerms(false);
      setShowAbout(false);
      // setShowPreferences(false);
    }
  }, [isOpen]);

  if (!isOpen) return null;

  // Convert provider string to authProviders array if needed
  const enhancedUserData = {
    ...localUserData,
    authProviders:
      localUserData.authProviders ||
      (localUserData.provider
        ? [{ name: localUserData.provider, linked: true }]
        : []),
  };

  // Handler for saving profile
  const handleSaveProfile = (updatedData: UserData, status: ProfileSaveStatus = {}) => {
    setLocalUserData({ ...updatedData, authProviders: updatedData.authProviders || localUserData.authProviders });
    setProfileNotice(status.message || "Profile saved.");
    if (!status.keepEditing) setIsEditing(false);
    onProfileUpdated?.();
  };

  // Choose the content based on states and device type
  let modalContent;
  if (showTerms) {
    modalContent = (
      <DesktopTerms
        onClose={onClose}
        onProfileClick={() => setShowTerms(false)}
        onShowAbout={() => {
          setShowTerms(false);
          setShowAbout(true);
        }}
        // onShowPreferences={() => {
        //   setShowTerms(false);
        //   setShowPreferences(true);
        // }}
      />
    );
  } else if (showAbout) {
    modalContent = (
      <DesktopAbout
        onClose={onClose}
        onProfileClick={() => setShowAbout(false)}
        onShowTerms={() => {
          setShowAbout(false);
          setShowTerms(true);
        }}
        // onShowPreferences={() => {
        //   setShowAbout(false);
        //   setShowPreferences(true);
        // }}
      />
    );
  }
  // else if (showPreferences) {
  //   modalContent = (
  //     <DesktopPreference
  //       onClose={onClose}
  //       onProfileClick={() => setShowPreferences(false)}
  //       onShowTerms={() => {
  //         setShowPreferences(false);
  //         setShowTerms(true);
  //       }}
  //       onShowAbout={() => {
  //         setShowPreferences(false);
  //         setShowAbout(true);
  //       }}
  //     />
  //   );
  // }
  else if (isEditing && isMobile) {
    modalContent = (
      <MobileEditProfile
        onClose={() => setIsEditing(false)}
        userData={enhancedUserData}
        onSave={handleSaveProfile}
      />
    );
  } else if (isEditing && !isMobile) {
    modalContent = (
      <DesktopEditProfile
        onClose={() => setIsEditing(false)}
        userData={enhancedUserData}
        onSave={handleSaveProfile}
      />
    );
  } else if (isMobile) {
    modalContent = (
      <ProfileModalMobile
        userData={enhancedUserData}
        onEdit={() => setIsEditing(true)}
      />
    );
  } else {
    modalContent = (
      <ProfileModalDesktop
        userData={enhancedUserData}
        onClose={onClose}
        onEdit={() => setIsEditing(true)}
        onShowTerms={() => setShowTerms(true)}
        onShowAbout={() => setShowAbout(true)}
        // onShowPreferences={() => setShowPreferences(true)}
      />
    );
  }

  return (
    <Dialog open={isOpen} onOpenChange={(open) => !open && onClose()}>
      <DialogContent
        className="p-0 border-none max-w-4xl bg-transparent shadow-none"
        onInteractOutside={(e) => e.preventDefault()}
      >
        <DialogTitle>
          <VisuallyHidden>
            {showTerms ? "Terms of Service" : "Edit Profile"}
            {showAbout ? "About us" : "Edit Profile"}
            {/* {showPreferences ? "Preferences" : "Edit Profile"} */}
          </VisuallyHidden>
        </DialogTitle>
        {profileNotice && !isEditing && <p role="status" className="rounded bg-blue-900 p-3 text-sm text-blue-100">{profileNotice}</p>}
        {modalContent}
      </DialogContent>
    </Dialog>
  );
}
