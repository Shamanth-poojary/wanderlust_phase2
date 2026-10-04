(() => {
  "use strict";

  // Enhanced client-side validation that trims values and applies Bootstrap classes
  const forms = document.querySelectorAll(".needs-validation");
  Array.from(forms).forEach((form) => {
    const validateControl = (control) => {
      if (!control || control.disabled) return true;
      let ok = true;
      const type = control.type;
      if (type === "radio" || type === "checkbox") {
        ok = control.checkValidity();
      } else {
        const val = control.value;
        if (typeof val === "string") {
          ok = val.trim() !== "" && control.checkValidity();
        } else {
          ok = control.checkValidity();
        }
      }
      if (!ok) {
        control.classList.add("is-invalid");
        control.classList.remove("is-valid");
      } else {
        control.classList.remove("is-invalid");
        control.classList.add("is-valid");
      }
      return ok;
    };

    form.addEventListener(
      "submit",
      (event) => {
        let allValid = true;
        const requiredControls = form.querySelectorAll("[required]");
        requiredControls.forEach((control) => {
          const valid = validateControl(control);
          if (!valid) allValid = false;
        });

        if (!allValid || !form.checkValidity()) {
          event.preventDefault();
          event.stopPropagation();
        }
        form.classList.add("was-validated");
      },
      false
    );

    form.addEventListener("input", (e) => {
      const target = e.target;
      if (!target) return;
      if (target.matches("[required]")) {
        validateControl(target);
      }
    });
  });

  // Toggle owner-fields block on signup form
  const ownerFields = document.getElementById("owner-fields");
  if (ownerFields) {
    const ownerRadio = document.getElementById("role-owner");
    const roleRadios = document.querySelectorAll('input[name="role"]');
    const inputs = ownerFields.querySelectorAll("input, select");

    const updateOwnerFields = () => {
      const isOwner = !!(ownerRadio && ownerRadio.checked);
      if (isOwner) {
        ownerFields.style.display = "";
        inputs.forEach((input) => {
          input.disabled = false;
          input.required = true;
        });
      } else {
        ownerFields.style.display = "none";
        inputs.forEach((input) => {
          input.disabled = true;
          input.required = false;
          input.classList.remove("is-invalid", "is-valid");
        });
      }
    };

    roleRadios.forEach((radio) => {
      radio.addEventListener("change", updateOwnerFields);
    });
    updateOwnerFields();
  }
})();
