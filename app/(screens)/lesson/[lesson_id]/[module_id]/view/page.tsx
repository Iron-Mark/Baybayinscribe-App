"use client";

import { useModuleStore } from "@/app/store/store.modules";
import { useParams, useRouter } from "next/navigation";
import { useEffect, useRef, useState } from "react";
import { useLessonContext } from "../../../LessonContext";
import ReactMarkdown from "react-markdown";
import remarkParse from "remark-parse";
import remarkBaybayin from "@/app/lib/remark-baybayin";
import axios from "axios";
// shadcn/ui imports
import { Skeleton } from "@/components/ui/skeleton";
import { Button } from "@/components/ui/button";
import { ChevronLeft } from "lucide-react";
import { authClient } from "@/app/lib/auth-client";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";

export default function ViewModule() {
  const { lesson_id, module_id } = useParams<{
    lesson_id: string;
    module_id: string;
  }>();
  const moduleStore = useModuleStore();
  const getModule = useModuleStore((state) => state.getModule);
  const lessonContext = useLessonContext();
  const router = useRouter();

  const buttonElement = useRef<HTMLButtonElement>(null);

  const [loadingMarkdown, setLoadingMarkdown] = useState(true);
  const [markdown, setMarkdown] = useState<string>(
    "You aren't supposed to see this"
  );
  const [showCongrats, setShowCongrats] = useState(false);
  const [markdownError, setMarkdownError] = useState<string | null>(null);

  useEffect(() => {
    if (lesson_id && module_id) {
      getModule(lesson_id, module_id);
    }
  }, [lesson_id, module_id, getModule]);

  useEffect(() => {
    if (moduleStore.status !== "Loaded") return;
    const url = moduleStore.module?.file?.[0]?.url;
    if (!url) {
      setMarkdownError("Module content is unavailable.");
      setLoadingMarkdown(false);
      return;
    }
    let cancelled = false;
    setLoadingMarkdown(true);
    setMarkdownError(null);
    void axios.get<string>(url).then((response) => {
      if (cancelled) return;
      setMarkdown(response.data);
      setLoadingMarkdown(false);
    }).catch(() => {
      if (cancelled) return;
      setMarkdownError("Unable to load module content. Please try again.");
      setLoadingMarkdown(false);
    });
    return () => { cancelled = true; };
  }, [moduleStore.status, moduleStore.module]);

  const markModuleAsComplete = async () => {
    if (!moduleStore.module) return;
    if (lessonContext.isGuest) {
      lessonContext.completeGuestModule(moduleStore.module.id);
      setShowCongrats(true);
      return;
    }
    const session = await authClient.getSession();
    if (!session || !session.data) {
      console.error("No session found");
      return;
    }

    if (!moduleStore.module) return;

    const completed = await moduleStore.markModuleFinished({
      lessonId: lesson_id,
      moduleId: moduleStore.module.id,
      userId: session.data.user.id,
    });

    if (completed) setShowCongrats(true);
  };

  if (moduleStore.status === "Error" || lessonContext.status === "Error" || markdownError) {
    return <main className="p-8" role="alert">{markdownError || moduleStore.error || lessonContext.error || "Unable to load module."}</main>;
  }

  // Show loading skeleton while markdown is loading, even after initial data load
  if (
    lessonContext.status === "Loading" ||
    moduleStore.status === "Loading" ||
    !lessonContext.lesson ||
    loadingMarkdown // <-- add this condition
  ) {
    return (
      <main className="w-full min-h-[60vh]  py-8">
        <article className="max-w-3xl mx-auto px-4">
          <Skeleton className="h-10 w-2/3 mb-6" />
          <Skeleton className="h-6 w-full mb-3" />
          <Skeleton className="h-6 w-5/6 mb-3" />
          <Skeleton className="h-6 w-2/3 mb-3" />
          <Skeleton className="h-6 w-1/2 mb-3" />
          <Skeleton className="h-6 w-3/4 mb-3" />
          <Skeleton className="h-6 w-2/3 mb-3" />
          <Skeleton className="h-6 w-1/2 mb-3" />
          <Skeleton className="h-10 w-40 mt-10" />
        </article>
      </main>
    );
  }

  return (
    <main className="w-full min-h-[80vh] py-10">
      <article className="max-w-3xl mx-auto px-4">
        <ChevronLeft className="my-4" onClick={() => router.back()} />
        <div className="prose prose-lg max-w-none">
          <ReactMarkdown
            remarkPlugins={[remarkParse, remarkBaybayin]}
            
          >
            {markdown}
          </ReactMarkdown>
        </div>
        <div className="mt-12">
          <Button
            ref={buttonElement}
            onClick={markModuleAsComplete}
            variant="default"
            size="lg"
            className="relative overflow-hidden"
          >
            {lessonContext.isGuest ? 'Complete Module (guest)' : 'Complete Module'}
          </Button>
        </div>
        <Dialog open={showCongrats} onOpenChange={setShowCongrats}>
          <DialogContent>
            <DialogHeader>
              <DialogTitle>Congratulations!</DialogTitle>
            </DialogHeader>
            <div className="py-2">
              You have completed this module. Great job!
              {lessonContext.isGuest && <p>Guest practice only — this is not saved to an account.</p>}
            </div>
            <DialogFooter>
              <Button onClick={() => setShowCongrats(false)}>
                Close
              </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>
      </article>
    </main>
  );
}
