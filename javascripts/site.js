(() => {
  let cleanup;

  function initializeSectionNavigation() {
    if (cleanup) cleanup();

    document.documentElement.classList.remove("landing-nav");

    const sections = [
      { id: "write-ups", label: "Write-ups" },
      { id: "cve-disclosures", label: "CVEs" },
      { id: "about-contact", label: "About & Contact" },
    ].map((item) => ({ ...item, element: document.getElementById(item.id) }));

    if (sections.some((section) => !section.element)) return;

    document.documentElement.classList.add("landing-nav");

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
        const hash = new URL(href, window.location.href).hash;
        const isActive = active.id === "home" ? !hash : hash === `#${active.id}`;
        link.classList.toggle("section-active", isActive);
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
      document.documentElement.classList.remove("landing-nav");
    };
  }

  if (typeof document$ !== "undefined") {
    document$.subscribe(initializeSectionNavigation);
  } else {
    document.addEventListener("DOMContentLoaded", initializeSectionNavigation);
  }
})();
