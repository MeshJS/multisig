import { User } from "@prisma/client";
import { create } from "zustand";

interface UserState {
  userAddress: string | undefined;
  setUserAddress: (address: string | undefined) => void;
  // courseVariant: CourseVariant | undefined;
  // setCourseVariant: (variant: CourseVariant | undefined) => void;
  // updateLessonEdit: undefined | any[];
  // setUpdateLessonEdit: (update: any[]) => void;
}

export const useUserStore = create<UserState>()((set, get) => ({
  userAddress: undefined,
  setUserAddress: (address) => set({ userAddress: address }),
  // courseVariant: undefined,
  // setCourseVariant: (variant) => set({ courseVariant: variant }),
  // updateLessonEdit: undefined,
  // setUpdateLessonEdit: (update) => set({ updateLessonEdit: update }),
}));
