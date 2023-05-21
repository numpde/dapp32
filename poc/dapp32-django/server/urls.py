from django.contrib import admin
from django.urls import path, include, re_path
from django.views.generic import TemplateView

ADDRESS_REGEX = r"0x[a-fA-F0-9]{40}"

urlpatterns = [
    # https://reactive-python.github.io/reactpy-django/get-started/installation/
    path("reactpy/", include("reactpy_django.http.urls")),

    # Django admin
    path("admin/", admin.site.urls),

    path(f"v/<str:network>/<str:address>", TemplateView.as_view(template_name="dapp32/view_contract.html")),

    path("metamask/", TemplateView.as_view(template_name="dapp32/metamask_test.html")),
]
