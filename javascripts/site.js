(() => {
  let cleanup;

  function initializeSectionNavigation() {
    if (cleanup) cleanup();

    const sections = [
      { id: "write-ups", label: "Write-ups" },
      { id: "cve-disclosures", label: "CVEs" },
      { id: "about-contact", label: "About & Contact" },
    ].map((item) => ({ ...item, element: document.getElementById(item.id) }));

    if (sections.some((section) => !section.element)) return;

    const topic = document.querySelector(".md-header__topic:last-child .md-ellipsis");
    const links = Array.from(document.querySelectorAll(".md-tabs__link"));

    function update() {
      const threshold = 145;
      let active = { id: "home", label: "Home" };

      for (const section of sections) {
        if (section.element.getBoundingClientRect().top <= threshold) active = section;
      }

      if (topic) topic.textContent = active.label;

      for (const link of links) {
        const href = link.getAttribute("href") || "";
        const isHome = active.id === "home" && !href.includes("#");
        link.classList.toggle("section-active", isHome || href.endsWith(`#${active.id}`));
      }
    }

    let ticking = false;
    function onScroll() {
      if (ticking) return;
      ticking = true;
      requestAnimationFrame(() => {
        update();
        ticking = false;
      });
    }

    window.addEventListener("scroll", onScroll, { passive: true });
    window.addEventListener("resize", onScroll);
    update();

    cleanup = () => {
      window.removeEventListener("scroll", onScroll);
      window.removeEventListener("resize", onScroll);
    };
  }

  if (typeof document$ !== "undefined") {
    document$.subscribe(initializeSectionNavigation);
  } else {
    document.addEventListener("DOMContentLoaded", initializeSectionNavigation);
  }
})();
