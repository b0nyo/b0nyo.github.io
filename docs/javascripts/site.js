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

    function headerBottom() {
      const header = document.querySelector(".md-header");
      const tabs = document.querySelector(".md-tabs");
      return Math.max(
        header ? header.getBoundingClientRect().bottom : 0,
        tabs ? tabs.getBoundingClientRect().bottom : 0,
      );
    }

    function scrollToSection(id, behavior = "smooth") {
      const section = sections.find((item) => item.id === id);
      const heading = section?.element.querySelector("h2");
      if (!heading) return;

      const top = window.scrollY + heading.getBoundingClientRect().top - headerBottom() - 18;
      window.scrollTo({ top, behavior });
    }

    function update() {
      const threshold = headerBottom() + 24;
      let active = { id: "home", label: "Home" };

      for (const section of sections) {
        const heading = section.element.querySelector("h2");
        if (heading && heading.getBoundingClientRect().top <= threshold) active = section;
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

    function onTabClick(event) {
      const hash = new URL(event.currentTarget.href, window.location.href).hash;
      const id = hash.slice(1);
      if (!sections.some((section) => section.id === id)) return;

      event.preventDefault();
      history.pushState(null, "", hash);
      scrollToSection(id);
    }

    for (const link of links) link.addEventListener("click", onTabClick);

    update();

    const initialId = window.location.hash.slice(1);
    if (sections.some((section) => section.id === initialId)) {
      requestAnimationFrame(() => scrollToSection(initialId, "auto"));
    }

    cleanup = () => {
      window.removeEventListener("scroll", onScroll);
      window.removeEventListener("resize", onScroll);
      for (const link of links) link.removeEventListener("click", onTabClick);
      document.documentElement.classList.remove("landing-nav");
    };
  }

  if (typeof document$ !== "undefined") {
    document$.subscribe(initializeSectionNavigation);
  } else {
    document.addEventListener("DOMContentLoaded", initializeSectionNavigation);
  }
})();
